import fs from "node:fs/promises";
import {
  buildProjectTree,
  filterExistingSafeReadFiles,
  filterSafeWriteTargets
} from "./context.js";
import { hasBlockingIssues } from "./reviewer.js";
import { loadEnvironment } from "../utils/api.js";
import { estimateRunCostFromPlan } from "../utils/cost-calculator.js";
import type {
  ContextFile,
  ExecutionStage,
  FileGenerationResult,
  IterationResult,
  Logger,
  MemoryAdapter,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  RetryHint,
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
  collectProviderUsageMetrics,
  createExecutionStateMachine,
  executeGenerationLoop,
  finalizeErroredRun,
  finalizeFailedRun,
  finalizeSuccessfulRun,
  loadImplementationMemoryContext,
  type LoopExecutionState,
  readAndPersistContext
} from "./run-executor.js";
import { buildExecutionSummary } from "./execution-summary.js";
import { expandContextReadFiles } from "./context-intelligence.js";
import { loadEditableContextCheckpoint, loadEditablePlanCheckpoint } from "./manual-checkpoints.js";

export class Orchestrator {
  repoRoot: string;
  logger: Logger;
  configPath: string | null;
  confirmationHandler?: import("../types.js").ConfirmationHandler;

  constructor({
    repoRoot,
    logger,
    configPath = null,
    confirmationHandler
  }: {
    repoRoot: string;
    logger: Logger;
    configPath?: string | null;
    confirmationHandler?: import("../types.js").ConfirmationHandler;
  }) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.configPath = configPath;
    this.confirmationHandler = confirmationHandler;
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
    const executionMachine = createExecutionStateMachine(artifactState, null, this.logger);
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
    let plan: PlanResult = {
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
    const runRuntime = {
      ...implementationRuntime,
      plannerProvider: runtime.plannerProvider,
      planner: runtime.planner,
      providerSummary: {
        ...implementationRuntime.providerSummary,
        planner: runtime.plannerProvider.id
      }
    };

    const localConfirmCheckpoint = (message: string, artifactPath?: string | null) =>
      this.confirmationHandler
        ? this.confirmationHandler.confirmCheckpoint(message, artifactPath)
        : confirmCheckpoint({ message, artifactPath, logger: this.logger });

    if (pauseAfterPlan) {
      const confirmed = await localConfirmCheckpoint(
        "Plan checkpoint saved. Review the plan artifact before continuing?",
        artifactState.stepPaths.plan
      );
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
          providers: runRuntime.providerSummary,
          memoryStats,
          artifactState,
          latestContextRanking: contextExpansion.rankedCandidates,
          executionSteps: executionMachine.getSteps(),
          executionTransitions: executionMachine.getTransitions(),
          budgetConfig: rules.execution?.budgets,
          usageMetrics: collectProviderUsageMetrics(runRuntime)
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
      plan = await loadEditablePlanCheckpoint(artifactState.stepPaths.plan, plan, repoRoot, rules, this.logger);
    }

    const localConfirmPlan = (p: PlanResult) =>
      this.confirmationHandler ? this.confirmationHandler.confirmPlan(p) : confirmPlan(p);

    if (interactive) {
      const confirmed = await localConfirmPlan(plan);
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
          budgetConfig: rules.execution?.budgets,
          providers: runRuntime.providerSummary,
          usageMetrics: collectProviderUsageMetrics(runRuntime),
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
          providers: runRuntime.providerSummary,
          memory: memoryStats,
          artifacts: null,
          execution,
          wroteFiles: false
        };
      }
    }

    let skippedFiles: string[] = [];
    let workingState: LoopExecutionState = {
      currentResult: null,
      acceptedIssues: [],
      latestReviewSummary: "",
      iterationResults: [],
      latestToolResults: [],
      executionMachine
    };

    try {
      const implementationMemoryStep = await executionMachine.runStage(
        "implementation-memory",
        async () => await loadImplementationMemoryContext(runRuntime.memory, task, plan, memoryStats, this.logger),
        { detail: "Loaded implementation memories." }
      );
      const implementationMemoryContext = implementationMemoryStep.result;
      const contextStep = await executionMachine.runStage(
        "context",
        async () => await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger),
        { detail: `Read ${plan.readFiles.length} context file(s).` }
      );
      let { contextFiles } = contextStep.result;
      skippedFiles = contextStep.result.skippedFiles;
      if (pauseAfterPlan) {
        const confirmed = await localConfirmCheckpoint(
          "Context checkpoint saved. Edit context.json or files/ before generation if needed.",
          artifactState.stepPaths.context
        );
        if (!confirmed) {
          this.logger.warn("Task paused by user after context checkpoint.");
          await executionMachine.pauseStage("paused", {
            durationMs: 0,
            detail: "Paused after context checkpoint."
          });
          const result = buildStoppedResult({
            status: "paused_after_plan",
            dryRun,
            repoRoot,
            configPath,
            plan,
            providers: runRuntime.providerSummary,
            memoryStats,
            artifactState,
            skippedContextFiles: skippedFiles,
            latestContextRanking: contextExpansion.rankedCandidates,
            executionSteps: executionMachine.getSteps(),
            executionTransitions: executionMachine.getTransitions(),
            budgetConfig: rules.execution?.budgets,
            usageMetrics: collectProviderUsageMetrics(runRuntime)
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
        contextFiles = await loadEditableContextCheckpoint(artifactState.stepPaths.context, contextFiles, this.logger);
      }

      const costEstimate = estimateRunCostFromPlan({
        task,
        plan,
        contextFiles,
        providerSummary: runRuntime.providerSummary,
        rules
      });
      this.logger.dashboard?.({
        message: "Pre-generation cost estimate ready.",
        budget: costEstimate.budget,
        providerMetrics: buildExecutionSummary({
          steps: executionMachine.getSteps(),
          transitions: executionMachine.getTransitions(),
          providers: runRuntime.providerSummary,
          usageMetrics: [...collectProviderUsageMetrics(runRuntime), ...costEstimate.usageMetrics]
        }).providerMetrics ?? [],
        artifactPath: artifactState.stepPaths.context
      });
      if (costEstimate.budget?.exceeded === "cost") {
        const message = `Estimated run cost ${costEstimate.budget.totalCostUnits.toFixed(3)} exceeds max_cost_units ${costEstimate.budget.maxCostUnits?.toFixed(3)}.`;
        const confirmed = interactive
          ? await localConfirmCheckpoint(message, artifactState.stepPaths.context)
          : false;
        if (!confirmed) {
          this.logger.warn(`${message} Stopping before generation.`);
          return finalizeFailedRun({
            task,
            dryRun,
            pauseAfterPlan,
            pauseAfterGenerate,
            repoRoot,
            configPath,
            plan,
            skippedFiles,
            runtime: runRuntime,
            memoryStats,
            artifactState,
            state: workingState,
            retryHint: {
              stage: "iteration-generate",
              reason: "Resume generation after confirming or raising the cost budget."
            },
            resultStatus: "failed",
            persistedStatus: "failed",
            budgetConfig: rules.execution?.budgets,
            additionalUsageMetrics: costEstimate.usageMetrics,
            logger: this.logger
          });
        }
      }

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
        runtime: runRuntime,
        memoryStats,
        artifactState,
        initialState: workingState,
        contextFiles,
        rules,
        logger: this.logger,
        confirmCheckpoint: localConfirmCheckpoint,
        successResultStatus: undefined,
        successPersistedStatus: "completed",
        budgetConfig: rules.execution?.budgets
      });
      workingState = loopExecution.state;

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
        runtime: runRuntime,
        memoryStats,
        artifactState,
        state: loopExecution.state,
        retryHint: createIterationLimitRetryHint(loopExecution.state),
        resultStatus: undefined,
        persistedStatus: "failed",
        budgetConfig: rules.execution?.budgets,
        logger: this.logger
      });
    } catch (error) {
      const normalized = error as Error;
      this.logger.error(normalized.message);
      return await finalizeErroredRun({
        task,
        dryRun,
        pauseAfterPlan,
        pauseAfterGenerate,
        repoRoot,
        configPath,
        plan,
        skippedFiles,
        runtime: runRuntime,
        memoryStats,
        artifactState,
        state: workingState,
        retryHint: createRetryHintFromState(workingState, normalized),
        budgetConfig: rules.execution?.budgets,
        logger: this.logger
      });
    }
  }

  async resume(resumeTarget: string, options: { stage?: ExecutionStage | null } = {}): Promise<OrchestratorResult> {
    const repoRoot = await fs.realpath(this.repoRoot);
    await loadEnvironment(repoRoot);

    const { rules, configPath } = await loadRules(repoRoot, this.configPath);

    const statePath = await resolveResumeStatePath(repoRoot, rules, resumeTarget);
    const saved = JSON.parse(await fs.readFile(statePath, "utf8")) as PersistedRunState;
    if (!saved?.status || !isResumableRunStatus(saved.status, saved.execution?.retryHint ?? null, options.stage ?? null)) {
      throw new Error(`Resume target is not resumable: ${statePath}`);
    }

    const task = saved.task ?? "";
    const { routing: planningRouting } = await loadOrchestratorRuntime({
      repoRoot,
      explicitConfigPath: this.configPath,
      logger: this.logger,
      task
    });
    const dryRun = saved.dryRun ?? false;
    let plan = saved.plan;
    let skippedFiles: string[] = saved.skippedContextFiles ?? [];
    let iterationResults: IterationResult[] = Array.isArray(saved.iterations) ? [...saved.iterations] : [];
    let currentResult: FileGenerationResult | null = saved.result ?? null;
    let acceptedIssues: ReviewIssue[] = Array.isArray(saved.finalIssues) ? saved.finalIssues : [];
    let latestReviewSummary = typeof saved.latestReviewSummary === "string" ? saved.latestReviewSummary : "";
    const pauseAfterGenerate = saved.pauseAfterGenerate === true;
    const artifactState = restoreArtifactState(repoRoot, rules, saved.artifacts, statePath);
    const executionMachine = createExecutionStateMachine(artifactState, saved.execution ?? null, this.logger);
    if (saved.status === "paused_after_plan") {
      plan = await loadEditablePlanCheckpoint(artifactState.stepPaths.plan, plan, repoRoot, rules, this.logger);
    }
    const resumeStrategy = resolveResumeStrategy(saved, currentResult, acceptedIssues, iterationResults, options.stage ?? null);
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

    const localConfirmCheckpoint = (message: string, artifactPath?: string | null) =>
      this.confirmationHandler
        ? this.confirmationHandler.confirmCheckpoint(message, artifactPath)
        : confirmCheckpoint({ message, artifactPath, logger: this.logger });

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

    if ((saved.status === "paused_after_generate" || resumeStrategy.kind === "finalize-success") && currentResult && !hasBlockingIssues(acceptedIssues)) {
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
        startAtStage: resumeStrategy.kind === "finalize-success" ? resumeStrategy.stage : "write-files",
        resultStatus: "resumed_completed",
        persistedStatus: "resumed_completed",
        budgetConfig: rules.execution?.budgets,
        logger: this.logger
      });
    }

    if (resumeStrategy.kind === "finalize-failure") {
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
        state: {
          currentResult,
          acceptedIssues,
          latestReviewSummary,
          iterationResults,
          latestToolResults: saved.latestToolResults ?? [],
          executionMachine
        },
        retryHint: saved.execution?.retryHint ?? createIterationLimitRetryHint({
          currentResult,
          acceptedIssues,
          latestReviewSummary,
          iterationResults,
          latestToolResults: saved.latestToolResults ?? [],
          executionMachine
        }),
        startAtStage: resumeStrategy.stage,
        resultStatus: "failed",
        persistedStatus: "failed",
        budgetConfig: rules.execution?.budgets,
        logger: this.logger
      });
    }

    if (resumeStrategy.kind !== "loop") {
      throw new Error("Unexpected non-loop resume strategy reached generation loop.");
    }

    const loopExecution = await executeGenerationLoop({
      startIteration: resumeStrategy.startIteration,
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
      confirmCheckpoint: localConfirmCheckpoint,
      resumeFromStage: resumeStrategy.resumeFromStage,
      successResultStatus: "resumed_completed",
      successPersistedStatus: "resumed_completed",
      budgetConfig: rules.execution?.budgets
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
      retryHint: createIterationLimitRetryHint(loopExecution.state),
      resultStatus: "failed",
      persistedStatus: "failed",
      budgetConfig: rules.execution?.budgets,
      logger: this.logger
    });
  }

}

function isResumableRunStatus(status: string, retryHint: RetryHint | null, forcedStage: ExecutionStage | null = null): boolean {
  return status.startsWith("paused_") || (status === "failed" && (!!retryHint || !!forcedStage));
}

function createIterationLimitRetryHint(state: LoopExecutionState): RetryHint | null {
  if (!state.currentResult || !hasBlockingIssues(state.acceptedIssues)) {
    return null;
  }

  return {
    stage: "iteration-fix",
    iteration: state.iterationResults.length + 1,
    reason: "Retry the next fix iteration using the latest candidate and review issues."
  };
}

function createRetryHintFromState(state: LoopExecutionState, error: Error): RetryHint {
  const transitions = state.executionMachine.getTransitions();
  const lastFailedTransition = [...transitions].reverse().find((entry) => entry.status === "failed");
  const failedStage = lastFailedTransition?.stage ?? "failure";
  const failedIteration = lastFailedTransition?.iteration;

  if (failedStage === "iteration-review" || failedStage === "iteration-tools") {
    return {
      stage: "iteration-tools",
      iteration: failedIteration ?? Math.max(1, state.iterationResults.length),
      reason: error.message
    };
  }

  if (failedStage === "iteration-generate" || failedStage === "iteration-fix") {
    return {
      stage: failedStage,
      iteration:
        failedIteration ??
        Math.max(1, state.iterationResults.length + (failedStage === "iteration-fix" ? 1 : 0)),
      reason: error.message
    };
  }

  if (failedStage === "write-files" || failedStage === "memory-store" || failedStage === "context" || failedStage === "implementation-memory") {
    return {
      stage: failedStage,
      reason: error.message
    };
  }

  return {
    stage: "iteration-generate",
    iteration: state.iterationResults.length + 1,
    reason: error.message
  };
}

function resolveResumeStrategy(
  saved: PersistedRunState,
  currentResult: FileGenerationResult | null,
  acceptedIssues: ReviewIssue[],
  iterationResults: IterationResult[],
  forcedStage: ExecutionStage | null
):
  | { kind: "loop"; startIteration: number; resumeFromStage?: "iteration-generate" | "iteration-tools" }
  | { kind: "finalize-success"; stage: "write-files" | "memory-store" }
  | { kind: "finalize-failure"; stage: "memory-store" } {
  const blockingIssues = hasBlockingIssues(acceptedIssues);
  const effectiveRetryHint = forcedStage
    ? createForcedRetryHint(forcedStage, currentResult, iterationResults)
    : saved.execution?.retryHint ?? null;
  if (saved.status === "paused_after_plan") {
    return { kind: "loop", startIteration: 1 };
  }

  if (saved.status === "paused_after_generate") {
    if (currentResult && !blockingIssues) {
      return { kind: "finalize-success", stage: "write-files" };
    }
    return {
      kind: "loop",
      startIteration: currentResult ? iterationResults.length + 1 : 1,
      resumeFromStage: "iteration-generate"
    };
  }

  const retryHint = effectiveRetryHint;
  if (!retryHint) {
    return {
      kind: "loop",
      startIteration: currentResult ? iterationResults.length + 1 : 1,
      resumeFromStage: currentResult ? "iteration-generate" : undefined
    };
  }

  if (retryHint.stage === "write-files") {
    return { kind: "finalize-success", stage: "write-files" };
  }

  if (retryHint.stage === "memory-store") {
    return blockingIssues ? { kind: "finalize-failure", stage: "memory-store" } : { kind: "finalize-success", stage: "memory-store" };
  }

  if (retryHint.stage === "iteration-tools" || retryHint.stage === "iteration-review") {
    return {
      kind: "loop",
      startIteration: retryHint.iteration ?? Math.max(1, iterationResults.length),
      resumeFromStage: "iteration-tools"
    };
  }

  if (retryHint.stage === "iteration-generate" || retryHint.stage === "iteration-fix") {
    return {
      kind: "loop",
      startIteration: retryHint.iteration ?? Math.max(1, currentResult ? iterationResults.length + 1 : 1),
      resumeFromStage: "iteration-generate"
    };
  }

  return {
    kind: "loop",
    startIteration: currentResult ? iterationResults.length + 1 : 1,
    resumeFromStage: currentResult ? "iteration-generate" : undefined
  };
}

function createForcedRetryHint(
  stage: ExecutionStage,
  currentResult: FileGenerationResult | null,
  iterationResults: IterationResult[]
): RetryHint {
  const latestIteration = Math.max(1, iterationResults.length);
  const nextIteration = currentResult ? latestIteration + 1 : latestIteration;

  switch (stage) {
    case "planner":
      return { stage: "iteration-generate", iteration: 1, reason: "User requested retry from planning." };
    case "context":
    case "implementation-memory":
    case "context-restore":
      return { stage: "context", reason: "User requested retry from context loading." };
    case "iteration-tools":
    case "iteration-review":
      return {
        stage: "iteration-tools",
        iteration: currentResult ? latestIteration : 1,
        reason: "User requested retry from checking/reviewing."
      };
    case "iteration-fix":
      return {
        stage: "iteration-fix",
        iteration: currentResult ? nextIteration : 1,
        reason: "User requested retry from fixing."
      };
    case "write-files":
      return { stage: "write-files", reason: "User requested retry from write-files." };
    case "memory-store":
      return { stage: "memory-store", reason: "User requested retry from memory-store." };
    case "iteration-generate":
    default:
      return {
        stage: "iteration-generate",
        iteration: currentResult ? nextIteration : 1,
        reason: "User requested retry from generating."
      };
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
