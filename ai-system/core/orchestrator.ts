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
  persistRoutingArtifacts,
  persistRunState,
  resolveResumeStatePath,
  restoreArtifactState,
  type PersistedRunState
} from "./artifacts.js";
import { confirmCheckpoint, confirmPlan } from "./orchestrator-confirmation.js";
import { loadOrchestratorRuntime, loadRules, rerouteRuntimeForPlan } from "./orchestrator-runtime.js";
import {
  createExecutionStateMachine,
  executeGenerationLoop,
  finalizeFailedRun,
  finalizeSuccessfulRun,
  loadImplementationMemoryContext,
  readAndPersistContext
} from "./run-executor.js";
import { buildExecutionSummary } from "./execution-summary.js";
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
    const artifactState = createArtifactState(repoRoot, rules);
    const executionMachine = createExecutionStateMachine(artifactState);
    await executionMachine.runStage("routing-planning", async () => {
      await persistRoutingArtifacts(
        artifactState,
        {
          stage: routing.stage,
          task,
          decision: routing
        },
        this.logger
      );
    }, { detail: `Planning routing uses profile ${routing.profile}.` });

    this.logger.step(`Building project tree for ${repoRoot}`);
    const treeStep = await executionMachine.runStage("project-tree", async () => await buildProjectTree(repoRoot, rules));
    const treeString = treeStep.result;

    const planningMemoryStep = await executionMachine.runStage(
      "planning-memory",
      async () =>
        await safelySearchMemory(
          runtime.memory,
          { task, stage: "planning" },
          this.logger
        ),
      { detail: "Loaded planning memories." }
    );
    const planningMemories = planningMemoryStep.result;
    memoryStats.planningMatches = planningMemories.length;
    const planningMemoryContext = runtime.memory.formatForPrompt(planningMemories, "planning");

    this.logger.step(`Planning relevant files with ${runtime.plannerProvider.id}`);
    const plannerStep = await executionMachine.runStage(
      "planner",
      async () => await runtime.planner.planTask(task, treeString, repoRoot, planningMemoryContext),
      { detail: `Planner provider: ${runtime.plannerProvider.id}.` }
    );
    const rawPlan = plannerStep.result;
    const initialReadFiles = await filterExistingSafeReadFiles(repoRoot, rawPlan.readFiles ?? [], rules, this.logger);
    const contextExpansionStep = await executionMachine.runStage(
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
      { detail: `Expanded context from ${initialReadFiles.length} planned file(s) to include dependency and semantic matches.` }
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
        ...(contextExpansion.rankedCandidates.length > 0
          ? [
              `Context ranking: ${contextExpansion.rankedCandidates
                .slice(0, 5)
                .map((entry) => `${entry.path} [${entry.sources.join("+")}]`)
                .join(", ")}`
            ]
          : []),
        ...(contextExpansion.changedHintFiles.length > 0
          ? [`Changed-file hints: ${contextExpansion.changedHintFiles.join(", ")}`]
          : []),
        ...(contextExpansion.budgetTrimmedFiles.length > 0
          ? [`Context budget trimmed: ${contextExpansion.budgetTrimmedFiles.join(", ")}`]
          : []),
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
        vectorMatches: contextExpansion.vectorMatches,
        rankedCandidates: contextExpansion.rankedCandidates,
        provider: runtime.plannerProvider.id,
        durationMs: plannerStep.durationMs
      },
      this.logger
    );
    const implementationRoutingStep = await executionMachine.runStage(
      "routing-implementation",
      async () =>
        await rerouteRuntimeForPlan({
          repoRoot,
          rules,
          task,
          plan,
          logger: this.logger
        }),
      { detail: "Implementation routing evaluated after the plan." }
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
        await executionMachine.pauseStage("paused", {
          durationMs: 0,
          detail: "Paused after planner checkpoint."
        });
        const result = buildStoppedResult({
          status: "paused_after_plan",
          dryRun,
          repoRoot,
          configPath,
          plan,
          providers: implementationRuntime.providerSummary,
          memoryStats,
          artifactState,
          latestContextRanking: contextExpansion.rankedCandidates,
          executionSteps: executionMachine.getSteps(),
          executionTransitions: executionMachine.getTransitions()
        });
        await persistRunState(
          artifactState,
          {
            ...result,
            task,
            pauseAfterPlan,
            pauseAfterGenerate,
            latestReviewSummary: "",
            latestContextRanking: contextExpansion.rankedCandidates,
            execution: result.execution,
            executionTransitions: executionMachine.getTransitions()
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
        await executionMachine.cancelStage("cancelled", {
          durationMs: 0,
          detail: "Run cancelled by user before implementation started."
        });
        const execution = buildExecutionSummary({
          status: "cancelled",
          steps: executionMachine.getSteps(),
          transitions: executionMachine.getTransitions(),
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

    const implementationMemoryStep = await executionMachine.runStage(
      "implementation-memory",
      async () => await loadImplementationMemoryContext(implementationRuntime.memory, task, plan, memoryStats, this.logger),
      { detail: "Loaded implementation memories." }
    );
    const implementationMemoryContext = implementationMemoryStep.result;
    const contextStep = await executionMachine.runStage(
      "context",
      async () => await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger),
      { detail: `Read ${plan.readFiles.length} context file(s).` }
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
        executionMachine
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
    const executionMachine = createExecutionStateMachine(artifactState, saved.execution ?? null);
    await executionMachine.runStage(
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
      { detail: `Planning routing uses profile ${planningRouting.profile} during resume.` }
    );
    const implementationRoutingStep = await executionMachine.runStage(
      "routing-implementation",
      async () =>
        await rerouteRuntimeForPlan({
          repoRoot,
          rules,
          task,
          plan,
          logger: this.logger
        }),
      { detail: "Implementation routing evaluated during resume." }
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
    const implementationMemoryStep = await executionMachine.runStage(
      "implementation-memory",
      async () => await loadImplementationMemoryContext(runtime.memory, task, plan, memoryStats, this.logger),
      { detail: "Loaded implementation memories during resume." }
    );
    const implementationMemoryContext = implementationMemoryStep.result;

    const contextRestoreStep = await executionMachine.runStage(
      "context-restore",
      async () => await loadSavedContextArtifacts(artifactState, plan.readFiles ?? []),
      { detail: "Loaded saved context artifacts for resume." }
    );
    let contextFiles: ContextFile[] = contextRestoreStep.result;
    if (saved.status === "paused_after_plan" && contextFiles.length === 0) {
      const contextResultStep = await executionMachine.runStage(
        "context",
        async () => await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger),
        { detail: `Read ${plan.readFiles.length} context file(s) during resume.` }
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
          executionMachine
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
        executionMachine
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
