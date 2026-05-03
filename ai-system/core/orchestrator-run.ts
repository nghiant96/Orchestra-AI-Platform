import fs from "node:fs/promises";
import { buildProjectTree, filterExistingSafeReadFiles, filterSafeWriteTargets } from "./context.js";
import { performRefactorAnalysis } from "./refactor-analysis.js";
import { DependencyGraph } from "./dependency-graph.js";
import { estimateRunCostFromPlan } from "../utils/cost-calculator.js";
import { loadEnvironment } from "../utils/api.js";
import type {
  ExternalTaskRef,
  ExternalTaskUpdatePreview,
  Logger,
  MemoryStats,
  OrchestratorResult,
  ApprovalPolicyDecision,
  PlanResult,
  WorkflowMode,
  RetryHint
} from "../types.js";
import {
  buildStoppedResult,
  createArtifactState,
  persistPlanArtifacts,
  persistRoutingArtifacts,
  persistRunState
} from "./artifacts.js";
import { confirmCheckpoint, confirmPlan } from "./orchestrator-confirmation.js";
import { loadOrchestratorRuntime, rerouteRuntimeForPlan } from "./orchestrator-runtime.js";
import {
  collectProviderUsageMetrics,
  createExecutionStateMachine,
  executeGenerationLoop,
  finalizeErroredRun,
  finalizeFailedRun,
  loadImplementationMemoryContext,
  readAndPersistContext,
  type LoopExecutionState
} from "./run-executor.js";
import { buildExecutionSummary } from "./execution-summary.js";
import { expandContextReadFiles } from "./context-intelligence.js";
import { loadEditableContextCheckpoint, loadEditablePlanCheckpoint } from "./manual-checkpoints.js";
import { enhancePlanForTaskRequirements } from "./task-requirements.js";
import { resolveApprovalPolicy } from "./risk-policy.js";
import { formatLessonsForPrompt, readProjectLessons } from "./lessons.js";
import { OrchestratorHost } from "./orchestrator-shared.js";

export async function runOrchestrator(
  host: OrchestratorHost,
  task: string,
  {
    dryRun = false,
    interactive = false,
    pauseAfterPlan = false,
    pauseAfterGenerate = false,
    approvalPolicy = null,
    externalTask = null,
    workflowMode = "standard",
    signal
  }: {
    dryRun?: boolean;
    interactive?: boolean;
    pauseAfterPlan?: boolean;
    pauseAfterGenerate?: boolean;
    approvalPolicy?: ApprovalPolicyDecision | null;
    externalTask?: ExternalTaskRef | null;
    workflowMode?: WorkflowMode;
    externalUpdatePreviews?: ExternalTaskUpdatePreview[];
    signal?: AbortSignal;
  } = {}
): Promise<OrchestratorResult> {
  if (signal?.aborted) throw new Error("AbortError");
  const repoRoot = await fs.realpath(host.repoRoot);
  await loadEnvironment(repoRoot);

  const { rules, configPath, runtime, routing } = await loadOrchestratorRuntime({
    repoRoot,
    explicitConfigPath: host.configPath,
    logger: host.logger,
    task
  });

  const memoryStats: MemoryStats = {
    backend: runtime.memory.id,
    planningMatches: 0,
    implementationMatches: 0,
    stored: false
  };
  const artifactState = createArtifactState(repoRoot, rules);
  let effectiveApprovalPolicy = approvalPolicy ?? resolveApprovalPolicy(task, rules, [], { workflowMode });
  let effectiveInteractive = interactive;
  let effectivePauseAfterPlan = pauseAfterPlan;
  let effectivePauseAfterGenerate = pauseAfterGenerate;
  const executionMachine = createExecutionStateMachine(artifactState, null, host.logger);
  await executionMachine.runStage("routing-planning", async () => {
    await persistRoutingArtifacts(
      artifactState,
      {
        stage: routing.stage,
        task,
        decision: routing
      },
      host.logger
    );
  }, { detail: `Planning routing uses profile ${routing.profile}.` });

  host.logger.step(`Building project tree for ${repoRoot}`);
  const treeStep = await executionMachine.runStage("project-tree", async () => await buildProjectTree(repoRoot, rules));
  const treeString = treeStep.result;

  const planningMemoryStep = await executionMachine.runStage(
    "planning-memory",
    async () => await safelySearchMemory(runtime.memory, { task, stage: "planning" }, host.logger),
    { detail: "Loaded planning memories." }
  );
  const planningMemories = planningMemoryStep.result;
  memoryStats.planningMatches = planningMemories.length;
  const projectLessons = await readProjectLessons(repoRoot);
  const planningMemoryContext = [
    runtime.memory.formatForPrompt(planningMemories, "planning"),
    formatLessonsForPrompt(projectLessons)
  ].filter(Boolean).join("\n\n");

  host.logger.step(`Planning relevant files with ${runtime.plannerProvider.id}`);
  const plannerStep = await executionMachine.runStage(
    "planner",
    async () => await runtime.planner.planTask(task, treeString, repoRoot, planningMemoryContext),
    { detail: `Planner provider: ${runtime.plannerProvider.id}.` }
  );
  const rawPlan = plannerStep.result;
  const initialReadFiles = await filterExistingSafeReadFiles(repoRoot, rawPlan.readFiles ?? [], rules, host.logger);
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
        logger: host.logger
      }),
    { detail: `Expanded context from ${initialReadFiles.length} planned file(s) to include dependency and semantic matches.` }
  );
  const contextExpansion = contextExpansionStep.result;
  const readFiles = contextExpansion.readFiles;
  const writeTargets = filterSafeWriteTargets(rawPlan.writeTargets ?? [], rules, host.logger);
  let plan: PlanResult = {
    prompt: typeof rawPlan.prompt === "string" ? rawPlan.prompt : task,
    readFiles,
    writeTargets,
    notes: [
      ...(Array.isArray(rawPlan.notes) ? rawPlan.notes : []),
      ...(contextExpansion.selectionSummary.length > 0
        ? [
            `Context selected: ${contextExpansion.selectionSummary
              .filter((entry) => !entry.exclusionReason)
              .slice(0, 5)
              .map((entry) => `${entry.path} [${entry.sources.join("+")}${entry.inclusionReason ? `; ${entry.inclusionReason}` : ""}]`)
              .join(", ")}`
          ]
        : []),
      ...(contextExpansion.selectionSummary.some((entry) => entry.exclusionReason)
        ? [
            `Context trimmed: ${contextExpansion.selectionSummary
              .filter((entry) => entry.exclusionReason)
              .slice(0, 5)
              .map((entry) => `${entry.path} (${entry.exclusionReason})`)
              .join(", ")}`
          ]
        : []),
      ...(contextExpansion.changedHintFiles.length > 0
        ? [`Changed-file hints: ${contextExpansion.changedHintFiles.join(", ")}`]
        : []),
      ...(contextExpansion.budgetSummary.trimmedCount > 0
        ? [
            `Context budget: selected ${contextExpansion.budgetSummary.selectedCount}/${contextExpansion.budgetSummary.maxExpandedFiles} file(s), ${contextExpansion.budgetSummary.selectedBytes} bytes kept, ${contextExpansion.budgetSummary.trimmedCount} trimmed`
          ]
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
  plan = enhancePlanForTaskRequirements(task, plan);

  let refactorAnalysis: import("../types.js").RefactorAnalysis | undefined;
  if (workflowMode === "refactor") {
    host.logger.step("Performing refactor analysis (read-only)");
    const dependencyGraph = new DependencyGraph(repoRoot);
    await dependencyGraph.buildGraph([...plan.readFiles, ...plan.writeTargets]);

    refactorAnalysis = await performRefactorAnalysis({
      repoRoot,
      goal: task,
      changedFiles: plan.writeTargets,
      dependencyGraph
    });
    plan.refactorAnalysis = refactorAnalysis;

    host.logger.info(`Refactor analysis complete. Identified ${refactorAnalysis.proposedBatches.length} batch(es).`);
  }

  if (!approvalPolicy) {
    effectiveApprovalPolicy = resolveApprovalPolicy(task, rules, plan.writeTargets, {
      workflowMode,
      changedPathCount: plan.writeTargets.length,
      generatedFileCount: plan.writeTargets.length
    });
    effectiveInteractive = effectiveApprovalPolicy.interactive;
    effectivePauseAfterPlan = effectiveApprovalPolicy.pauseAfterPlan;
    effectivePauseAfterGenerate = effectiveApprovalPolicy.pauseAfterGenerate;
  }
  await persistPlanArtifacts(
    artifactState,
    {
      task,
      rawPlan,
      plan,
      vectorMatches: contextExpansion.vectorMatches,
      rankedCandidates: contextExpansion.rankedCandidates,
      selectionSummary: contextExpansion.selectionSummary,
      budgetSummary: contextExpansion.budgetSummary,
      provider: runtime.plannerProvider.id,
      durationMs: plannerStep.durationMs,
      refactorAnalysis
    },
    host.logger
  );
  const implementationRoutingStep = await executionMachine.runStage(
    "routing-implementation",
    async () =>
      await rerouteRuntimeForPlan({
        repoRoot,
        rules,
        task,
        plan,
        logger: host.logger
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
    host.logger
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
    host.confirmationHandler
      ? host.confirmationHandler.confirmCheckpoint(message, artifactPath)
      : confirmCheckpoint({ message, artifactPath, logger: host.logger, signal });

  if (effectivePauseAfterPlan) {
    const confirmed = await localConfirmCheckpoint(
      "Plan checkpoint saved. Review the plan artifact before continuing?",
      artifactState.stepPaths.plan
    );
    if (!confirmed) {
      host.logger.warn("Task paused by user after planner checkpoint.");
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
        usageMetrics: collectProviderUsageMetrics(runRuntime),
        approvalPolicy: effectiveApprovalPolicy,
        externalTask: externalTask ?? undefined
      });
      await persistRunState(
        artifactState,
        {
          ...result,
          task,
          pauseAfterPlan: effectivePauseAfterPlan,
          pauseAfterGenerate: effectivePauseAfterGenerate,
          latestReviewSummary: "",
          latestContextRanking: contextExpansion.rankedCandidates,
          execution: result.execution,
          executionTransitions: executionMachine.getTransitions()
        },
        host.logger
      );
      return result;
    }
    plan = await loadEditablePlanCheckpoint(artifactState.stepPaths.plan, plan, repoRoot, rules, host.logger);
  }

  const localConfirmPlan = (p: PlanResult) =>
    host.confirmationHandler ? host.confirmationHandler.confirmPlan(p) : confirmPlan(p, signal);

  if (effectiveInteractive) {
    const confirmed = await localConfirmPlan(plan);
    if (!confirmed) {
      host.logger.warn("Task cancelled by user.");
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
        version: 1,
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
        approvalPolicy: effectiveApprovalPolicy,
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
      async () => await loadImplementationMemoryContext(runRuntime.memory, task, plan, memoryStats, host.logger),
      { detail: "Loaded implementation memories." }
    );
    const implementationMemoryContext = implementationMemoryStep.result;
    const contextStep = await executionMachine.runStage(
      "context",
      async () => await readAndPersistContext(repoRoot, plan, rules, artifactState, host.logger),
      { detail: `Read ${plan.readFiles.length} context file(s).` }
    );
    let { contextFiles } = contextStep.result;
    skippedFiles = contextStep.result.skippedFiles;
    if (effectivePauseAfterPlan) {
      const confirmed = await localConfirmCheckpoint(
        "Context checkpoint saved. Edit context.json or files/ before generation if needed.",
        artifactState.stepPaths.context
      );
      if (!confirmed) {
        host.logger.warn("Task paused by user after context checkpoint.");
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
          usageMetrics: collectProviderUsageMetrics(runRuntime),
          approvalPolicy: effectiveApprovalPolicy
        });
        await persistRunState(
          artifactState,
          {
            ...result,
            task,
            pauseAfterPlan: effectivePauseAfterPlan,
            pauseAfterGenerate: effectivePauseAfterGenerate,
            latestReviewSummary: "",
            latestContextRanking: contextExpansion.rankedCandidates,
            execution: result.execution,
            approvalPolicy: effectiveApprovalPolicy,
            executionTransitions: executionMachine.getTransitions()
          },
          host.logger
        );
        return result;
      }
      contextFiles = await loadEditableContextCheckpoint(artifactState.stepPaths.context, contextFiles, host.logger);
    }

    const costEstimate = estimateRunCostFromPlan({
      task,
      plan,
      contextFiles,
      providerSummary: runRuntime.providerSummary,
      rules
    });
    host.logger.dashboard?.({
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
        host.logger.warn(`${message} Stopping before generation.`);
        return finalizeFailedRun({
          task,
          dryRun,
          pauseAfterPlan: effectivePauseAfterPlan,
          pauseAfterGenerate: effectivePauseAfterGenerate,
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
          approvalPolicy: effectiveApprovalPolicy,
          externalTask,
          externalUpdatePreviews: [],
          logger: host.logger
        });
      }
    }

    const loopExecution = await executeGenerationLoop({
      startIteration: 1,
      task,
      dryRun,
      pauseAfterPlan: effectivePauseAfterPlan,
      pauseAfterGenerate: effectivePauseAfterGenerate,
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
      logger: host.logger,
      confirmCheckpoint: localConfirmCheckpoint,
      successResultStatus: undefined,
      successPersistedStatus: "completed",
      budgetConfig: rules.execution?.budgets,
      approvalPolicy: effectiveApprovalPolicy,
      externalTask,
      externalUpdatePreviews: [],
      signal
    });
    workingState = loopExecution.state;

    if (loopExecution.result) {
      return loopExecution.result;
    }

    return finalizeFailedRun({
      task,
      dryRun,
      pauseAfterPlan: effectivePauseAfterPlan,
      pauseAfterGenerate: effectivePauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      runtime: runRuntime,
      memoryStats,
      artifactState,
      state: loopExecution.state,
      retryHint: createIterationLimitRetryHint(workingState),
      resultStatus: undefined,
      persistedStatus: "failed",
      budgetConfig: rules.execution?.budgets,
      approvalPolicy: effectiveApprovalPolicy,
      logger: host.logger
    });
  } catch (error) {
    const normalized = error as Error;
    host.logger.error(normalized.message);
    return await finalizeErroredRun({
      task,
      dryRun,
      pauseAfterPlan: effectivePauseAfterPlan,
      pauseAfterGenerate: effectivePauseAfterGenerate,
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
      approvalPolicy: effectiveApprovalPolicy,
      externalTask,
      logger: host.logger
    });
  }
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

function createIterationLimitRetryHint(state: LoopExecutionState): RetryHint | null {
  if (!state.currentResult) {
    return null;
  }

  return {
    stage: "iteration-fix",
    iteration: state.iterationResults.length + 1,
    reason: "Retry the next fix iteration using the latest candidate and review issues."
  };
}

async function safelySearchMemory(memory: import("../types.js").MemoryAdapter, payload: Parameters<import("../types.js").MemoryAdapter["searchRelevant"]>[0], logger?: Logger) {
  try {
    return await memory.searchRelevant(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory search failed: ${normalized.message}`);
    return [];
  }
}
