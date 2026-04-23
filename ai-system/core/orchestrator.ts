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
  ExecutionStepSummary,
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
  persistRoutingArtifacts,
  persistRunState,
  resolveResumeStatePath,
  restoreArtifactState,
  type PersistedRunState
} from "./artifacts.js";
import { confirmCheckpoint, confirmPlan } from "./orchestrator-confirmation.js";
import { loadOrchestratorRuntime, loadRules, rerouteRuntimeForPlan } from "./orchestrator-runtime.js";
import {
  executeGenerationLoop,
  finalizeFailedRun,
  finalizeSuccessfulRun,
  loadImplementationMemoryContext,
  readAndPersistContext
} from "./run-executor.js";
import { buildExecutionSummary, measureExecutionStep } from "./execution-summary.js";
import { expandContextReadFiles } from "./context-intelligence.js";

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

    const { rules, configPath, runtime, routing } = await loadOrchestratorRuntime({
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
    const executionSteps: ExecutionStepSummary[] = [];
    const artifactState = createArtifactState(repoRoot, rules);
    await measureExecutionStep(executionSteps, "routing-planning", async () => {
      await persistRoutingArtifacts(
        artifactState,
        {
          stage: routing.stage,
          task,
          decision: routing
        },
        this.logger
      );
    }, `Planning routing uses profile ${routing.profile}.`);

    this.logger.step(`Building project tree for ${repoRoot}`);
    const treeStep = await measureExecutionStep(executionSteps, "project-tree", async () => await buildProjectTree(repoRoot, rules));
    const treeString = treeStep.result;

    const planningMemoryStep = await measureExecutionStep(
      executionSteps,
      "planning-memory",
      async () =>
        await safelySearchMemory(
          runtime.memory,
          { task, stage: "planning" },
          this.logger
        ),
      "Loaded planning memories."
    );
    const planningMemories = planningMemoryStep.result;
    memoryStats.planningMatches = planningMemories.length;
    const planningMemoryContext = runtime.memory.formatForPrompt(planningMemories, "planning");

    this.logger.step(`Planning relevant files with ${runtime.plannerProvider.id}`);
    const plannerStep = await measureExecutionStep(
      executionSteps,
      "planner",
      async () => await runtime.planner.planTask(task, treeString, repoRoot, planningMemoryContext),
      `Planner provider: ${runtime.plannerProvider.id}.`
    );
    const rawPlan = plannerStep.result;
    const initialReadFiles = await filterExistingSafeReadFiles(repoRoot, rawPlan.readFiles ?? [], rules, this.logger);
    const contextExpansionStep = await measureExecutionStep(
      executionSteps,
      "context-expansion",
      async () =>
        await expandContextReadFiles({
          repoRoot,
          rules,
          task,
          prompt: rawPlan.prompt,
          initialReadFiles,
          writeTargets: rawPlan.writeTargets ?? [],
          logger: this.logger
        }),
      `Expanded context from ${initialReadFiles.length} planned file(s) to include dependency and semantic matches.`
    );
    const contextExpansion = contextExpansionStep.result;
    const readFiles = contextExpansion.readFiles;
    const writeTargets = filterSafeWriteTargets(rawPlan.writeTargets ?? [], rules, this.logger);
    const plan: PlanResult = {
      prompt: typeof rawPlan.prompt === "string" ? rawPlan.prompt : task,
      readFiles,
      writeTargets,
      notes: [
        ...(Array.isArray(rawPlan.notes) ? rawPlan.notes : []),
        ...(contextExpansion.vectorMatches.length > 0
          ? [
              `Semantic context matches: ${contextExpansion.vectorMatches
                .map((match) => `${match.path}:${match.startLine}-${match.endLine}`)
                .join(", ")}`
            ]
          : [])
      ]
    };
    await persistPlanArtifacts(
      artifactState,
      {
        task,
        rawPlan,
        plan,
        provider: runtime.plannerProvider.id,
        durationMs: plannerStep.durationMs
      },
      this.logger
    );
    const implementationRoutingStep = await measureExecutionStep(
      executionSteps,
      "routing-implementation",
      async () =>
        await rerouteRuntimeForPlan({
          repoRoot,
          rules,
          task,
          plan,
          logger: this.logger
        }),
      "Implementation routing evaluated after the plan."
    );
    const implementationRouting = implementationRoutingStep.result;
    await persistRoutingArtifacts(
      artifactState,
      {
        stage: implementationRouting.routing.stage,
        task,
        decision: implementationRouting.routing,
        durationMs: implementationRoutingStep.durationMs
      },
      this.logger
    );
    const implementationRuntime = implementationRouting.runtime;

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
          providers: implementationRuntime.providerSummary,
          memoryStats,
          artifactState,
          executionSteps
        });
        await persistRunState(
          artifactState,
          {
            ...result,
            task,
            pauseAfterPlan,
            pauseAfterGenerate,
            latestReviewSummary: "",
            execution: result.execution
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
        const execution = buildExecutionSummary({
          status: "cancelled",
          steps: executionSteps,
          finalIssues: [],
          latestToolResults: [],
          iterations: []
        });
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
          providers: implementationRuntime.providerSummary,
          memory: memoryStats,
          artifacts: null,
          execution,
          wroteFiles: false
        };
      }
    }

    const implementationMemoryStep = await measureExecutionStep(
      executionSteps,
      "implementation-memory",
      async () => await loadImplementationMemoryContext(implementationRuntime.memory, task, plan, memoryStats, this.logger),
      "Loaded implementation memories."
    );
    const implementationMemoryContext = implementationMemoryStep.result;
    const contextStep = await measureExecutionStep(
      executionSteps,
      "context",
      async () => await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger),
      `Read ${plan.readFiles.length} context file(s).`
    );
    const { contextFiles, skippedFiles } = contextStep.result;

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
      runtime: implementationRuntime,
      memoryStats,
      artifactState,
      initialState: {
        currentResult: null,
        acceptedIssues: [],
        latestReviewSummary: "",
        iterationResults: [],
        latestToolResults: [],
        executionSteps
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
      runtime: implementationRuntime,
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
    const { routing: planningRouting } = await loadOrchestratorRuntime({
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
    const executionSteps: ExecutionStepSummary[] = [...(saved.execution?.steps ?? [])];
    await measureExecutionStep(
      executionSteps,
      "routing-planning",
      async () => {
        await persistRoutingArtifacts(
          artifactState,
          {
            stage: planningRouting.stage,
            task,
            decision: planningRouting
          },
          this.logger
        );
      },
      `Planning routing uses profile ${planningRouting.profile} during resume.`
    );
    const implementationRoutingStep = await measureExecutionStep(
      executionSteps,
      "routing-implementation",
      async () =>
        await rerouteRuntimeForPlan({
          repoRoot,
          rules,
          task,
          plan,
          logger: this.logger
        }),
      "Implementation routing evaluated during resume."
    );
    const implementationRouting = implementationRoutingStep.result;
    await persistRoutingArtifacts(
      artifactState,
      {
        stage: implementationRouting.routing.stage,
        task,
        decision: implementationRouting.routing,
        durationMs: implementationRoutingStep.durationMs
      },
      this.logger
    );
    const runtime = implementationRouting.runtime;

    const memoryStats: MemoryStats = {
      backend: runtime.memory.id,
      planningMatches: saved.memory?.planningMatches ?? 0,
      implementationMatches: saved.memory?.implementationMatches ?? 0,
      stored: false
    };
    const implementationMemoryStep = await measureExecutionStep(
      executionSteps,
      "implementation-memory",
      async () => await loadImplementationMemoryContext(runtime.memory, task, plan, memoryStats, this.logger),
      "Loaded implementation memories during resume."
    );
    const implementationMemoryContext = implementationMemoryStep.result;

    const contextRestoreStep = await measureExecutionStep(
      executionSteps,
      "context-restore",
      async () => await loadSavedContextArtifacts(artifactState, plan.readFiles ?? []),
      "Loaded saved context artifacts for resume."
    );
    let contextFiles: ContextFile[] = contextRestoreStep.result;
    if (saved.status === "paused_after_plan" && contextFiles.length === 0) {
      const contextResultStep = await measureExecutionStep(
        executionSteps,
        "context",
        async () => await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger),
        `Read ${plan.readFiles.length} context file(s) during resume.`
      );
      const contextResult = contextResultStep.result;
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
          iterationResults,
          latestToolResults: saved.latestToolResults ?? [],
          executionSteps
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
        iterationResults,
        latestToolResults: saved.latestToolResults ?? [],
        executionSteps
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
