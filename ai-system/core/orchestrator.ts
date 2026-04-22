import fs from "node:fs/promises";
import {
  buildProjectTree,
  filterExistingSafeReadFiles,
  filterSafeWriteTargets
} from "./context.js";
import { hasBlockingIssues } from "./reviewer.js";
import { loadEnvironment } from "../utils/api.js";
import type {
  ContextFile,
  FileGenerationResult,
  IterationResult,
  Logger,
  MemoryAdapter,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  ReviewIssue
} from "../types.js";
import {
  buildStoppedResult,
  createArtifactState,
  loadSavedContextArtifacts,
  persistPlanArtifacts,
  persistRunState,
  resolveResumeStatePath,
  restoreArtifactState,
  type PersistedRunState
} from "./artifacts.js";
import { confirmCheckpoint, confirmPlan } from "./orchestrator-confirmation.js";
import { loadOrchestratorRuntime, loadRules } from "./orchestrator-runtime.js";
import {
  executeGenerationLoop,
  finalizeFailedRun,
  finalizeSuccessfulRun,
  loadImplementationMemoryContext,
  readAndPersistContext
} from "./run-executor.js";

export class Orchestrator {
  repoRoot: string;
  logger: Logger;
  configPath: string | null;

  constructor({ repoRoot, logger, configPath = null }: { repoRoot: string; logger: Logger; configPath?: string | null }) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.configPath = configPath;
  }

  async run(
    task: string,
    {
      dryRun = false,
      interactive = false,
      pauseAfterPlan = false,
      pauseAfterGenerate = false
    }: { dryRun?: boolean; interactive?: boolean; pauseAfterPlan?: boolean; pauseAfterGenerate?: boolean } = {}
  ): Promise<OrchestratorResult> {
    const repoRoot = await fs.realpath(this.repoRoot);
    await loadEnvironment(repoRoot);

    const { rules, configPath, runtime } = await loadOrchestratorRuntime({
      repoRoot,
      explicitConfigPath: this.configPath,
      logger: this.logger,
      task
    });

    const memoryStats: MemoryStats = {
      backend: runtime.memory.id,
      planningMatches: 0,
      implementationMatches: 0,
      stored: false
    };
    const artifactState = createArtifactState(repoRoot, rules);

    this.logger.step(`Building project tree for ${repoRoot}`);
    const treeString = await buildProjectTree(repoRoot, rules);

    const planningMemories = await safelySearchMemory(
      runtime.memory,
      { task, stage: "planning" },
      this.logger
    );
    memoryStats.planningMatches = planningMemories.length;
    const planningMemoryContext = runtime.memory.formatForPrompt(planningMemories, "planning");

    this.logger.step(`Planning relevant files with ${runtime.plannerProvider.id}`);
    const rawPlan = await runtime.planner.planTask(task, treeString, repoRoot, planningMemoryContext);
    const readFiles = await filterExistingSafeReadFiles(repoRoot, rawPlan.readFiles ?? [], rules, this.logger);
    const writeTargets = filterSafeWriteTargets(rawPlan.writeTargets ?? [], rules, this.logger);
    const plan: PlanResult = {
      prompt: typeof rawPlan.prompt === "string" ? rawPlan.prompt : task,
      readFiles,
      writeTargets,
      notes: Array.isArray(rawPlan.notes) ? rawPlan.notes : []
    };
    await persistPlanArtifacts(
      artifactState,
      {
        task,
        rawPlan,
        plan,
        provider: runtime.plannerProvider.id
      },
      this.logger
    );

    if (pauseAfterPlan) {
      const confirmed = await confirmCheckpoint({
        message: "Plan checkpoint saved. Review the plan artifact before continuing?",
        artifactPath: artifactState.stepPaths.plan,
        logger: this.logger
      });
      if (!confirmed) {
        this.logger.warn("Task paused by user after planner checkpoint.");
        const result = buildStoppedResult({
          status: "paused_after_plan",
          dryRun,
          repoRoot,
          configPath,
          plan,
          providers: runtime.providerSummary,
          memoryStats,
          artifactState
        });
        await persistRunState(
          artifactState,
          {
            ...result,
            task,
            pauseAfterPlan,
            pauseAfterGenerate,
            latestReviewSummary: ""
          },
          this.logger
        );
        return result;
      }
    }

    if (interactive) {
      const confirmed = await confirmPlan(plan);
      if (!confirmed) {
        this.logger.warn("Task cancelled by user.");
        return {
          ok: false,
          status: "cancelled",
          dryRun,
          repoRoot,
          configPath,
          plan,
          result: null,
          iterations: [],
          issueCounts: { high: 0, medium: 0, low: 0 },
          skippedContextFiles: [],
          finalIssues: [],
          providers: runtime.providerSummary,
          memory: memoryStats,
          artifacts: null,
          wroteFiles: false
        };
      }
    }

    const implementationMemoryContext = await loadImplementationMemoryContext(runtime.memory, task, plan, memoryStats, this.logger);
    const { contextFiles, skippedFiles } = await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger);

    const loopExecution = await executeGenerationLoop({
      startIteration: 1,
      task,
      dryRun,
      pauseAfterPlan,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      implementationMemoryContext,
      runtime,
      memoryStats,
      artifactState,
      initialState: {
        currentResult: null,
        acceptedIssues: [],
        latestReviewSummary: "",
        iterationResults: []
      },
      contextFiles,
      rules,
      logger: this.logger,
      confirmCheckpoint: (message, artifactPath) => confirmCheckpoint({ message, artifactPath, logger: this.logger }),
      successResultStatus: undefined,
      successPersistedStatus: "completed"
    });

    if (loopExecution.result) {
      return loopExecution.result;
    }

    return finalizeFailedRun({
      task,
      dryRun,
      pauseAfterPlan,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      runtime,
      memoryStats,
      artifactState,
      state: loopExecution.state,
      resultStatus: undefined,
      persistedStatus: "failed",
      logger: this.logger
    });
  }

  async resume(resumeTarget: string): Promise<OrchestratorResult> {
    const repoRoot = await fs.realpath(this.repoRoot);
    await loadEnvironment(repoRoot);

    const { rules, configPath } = await loadRules(repoRoot, this.configPath);

    const statePath = await resolveResumeStatePath(repoRoot, rules, resumeTarget);
    const saved = JSON.parse(await fs.readFile(statePath, "utf8")) as PersistedRunState;
    if (!saved?.status || !String(saved.status).startsWith("paused_")) {
      throw new Error(`Resume target is not a paused run state: ${statePath}`);
    }

    const task = saved.task ?? "";
    const { runtime } = await loadOrchestratorRuntime({
      repoRoot,
      explicitConfigPath: this.configPath,
      logger: this.logger,
      task
    });
    const dryRun = saved.dryRun ?? false;
    const plan = saved.plan;
    let skippedFiles: string[] = saved.skippedContextFiles ?? [];
    let iterationResults: IterationResult[] = Array.isArray(saved.iterations) ? [...saved.iterations] : [];
    let currentResult: FileGenerationResult | null = saved.result ?? null;
    let acceptedIssues: ReviewIssue[] = Array.isArray(saved.finalIssues) ? saved.finalIssues : [];
    let latestReviewSummary = typeof saved.latestReviewSummary === "string" ? saved.latestReviewSummary : "";
    const pauseAfterGenerate = saved.pauseAfterGenerate === true;
    const artifactState = restoreArtifactState(repoRoot, rules, saved.artifacts, statePath);

    const memoryStats: MemoryStats = {
      backend: runtime.memory.id,
      planningMatches: saved.memory?.planningMatches ?? 0,
      implementationMatches: saved.memory?.implementationMatches ?? 0,
      stored: false
    };

    const implementationMemoryContext = await loadImplementationMemoryContext(runtime.memory, task, plan, memoryStats, this.logger);

    let contextFiles: ContextFile[] = await loadSavedContextArtifacts(artifactState, plan.readFiles ?? []);
    if (saved.status === "paused_after_plan" && contextFiles.length === 0) {
      const contextResult = await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger);
      contextFiles = contextResult.contextFiles;
      skippedFiles = contextResult.skippedFiles;
      currentResult = null;
      acceptedIssues = [];
      latestReviewSummary = "";
      iterationResults = [];
    }

    if (saved.status === "paused_after_generate" && currentResult && !hasBlockingIssues(acceptedIssues)) {
      return finalizeSuccessfulRun({
        task,
        dryRun,
        pauseAfterPlan: false,
        pauseAfterGenerate,
        repoRoot,
        configPath,
        plan,
        skippedFiles,
        runtime,
        memoryStats,
        artifactState,
        state: {
          currentResult,
          acceptedIssues,
          latestReviewSummary,
          iterationResults
        },
        resultStatus: "resumed_completed",
        persistedStatus: "resumed_completed",
        logger: this.logger
      });
    }

    const loopExecution = await executeGenerationLoop({
      startIteration: currentResult ? iterationResults.length + 1 : 1,
      task,
      dryRun,
      pauseAfterPlan: false,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      implementationMemoryContext,
      runtime,
      memoryStats,
      artifactState,
      initialState: {
        currentResult,
        acceptedIssues,
        latestReviewSummary,
        iterationResults
      },
      contextFiles,
      rules,
      logger: this.logger,
      confirmCheckpoint: (message, artifactPath) => confirmCheckpoint({ message, artifactPath, logger: this.logger }),
      successResultStatus: "resumed_completed",
      successPersistedStatus: "resumed_completed"
    });

    if (loopExecution.result) {
      return loopExecution.result;
    }

    return finalizeFailedRun({
      task,
      dryRun,
      pauseAfterPlan: false,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      runtime,
      memoryStats,
      artifactState,
      state: loopExecution.state,
      resultStatus: "failed",
      persistedStatus: "failed",
      logger: this.logger
    });
  }

}

async function safelySearchMemory(memory: MemoryAdapter, payload: Parameters<MemoryAdapter["searchRelevant"]>[0], logger?: Logger) {
  try {
    return await memory.searchRelevant(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory search failed: ${normalized.message}`);
    return [];
  }
}
