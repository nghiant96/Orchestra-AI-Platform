import fs from "node:fs/promises";
import type {
  ExecutionStage,
  FileGenerationResult,
  IterationResult,
  MemoryStats,
  OrchestratorResult,
  RetryHint,
  ReviewIssue,
  ContextFile
} from "../types.js";
import {
  loadSavedContextArtifacts,
  persistRoutingArtifacts,
  resolveResumeStatePath,
  restoreArtifactState,
  type PersistedRunState
} from "./artifacts.js";
import { confirmCheckpoint } from "./orchestrator-confirmation.js";
import { loadOrchestratorRuntime, loadRules, rerouteRuntimeForPlan } from "./orchestrator-runtime.js";
import {
  createExecutionStateMachine,
  executeGenerationLoop,
  finalizeFailedRun,
  finalizeSuccessfulRun,
  loadImplementationMemoryContext,
  readAndPersistContext,
  type LoopExecutionState
} from "./run-executor.js";
import { hasBlockingIssues } from "./reviewer.js";
import { loadEditablePlanCheckpoint } from "./manual-checkpoints.js";
import { loadEnvironment } from "../utils/api.js";
import { resolveApprovalPolicy } from "./risk-policy.js";
import type { OrchestratorHost } from "./orchestrator-shared.js";

export async function resumeOrchestrator(
  host: OrchestratorHost,
  resumeTarget: string,
  options: { stage?: ExecutionStage | null; signal?: AbortSignal } = {}
): Promise<OrchestratorResult> {
  const { signal } = options;
  if (signal?.aborted) throw new Error("AbortError");
  const repoRoot = await fs.realpath(host.repoRoot);
  await loadEnvironment(repoRoot);

  const { rules, configPath } = await loadRules(repoRoot, host.configPath);

  const statePath = await resolveResumeStatePath(repoRoot, rules, resumeTarget);
  const saved = JSON.parse(await fs.readFile(statePath, "utf8")) as PersistedRunState;
  if (!saved?.status || !isResumableRunStatus(saved.status, saved.execution?.retryHint ?? null, options.stage ?? null)) {
    throw new Error(`Resume target is not resumable: ${statePath}`);
  }

  const task = saved.task ?? "";
  const { routing: planningRouting } = await loadOrchestratorRuntime({
    repoRoot,
    explicitConfigPath: host.configPath,
    logger: host.logger,
    task
  });
  const dryRun = saved.dryRun ?? false;
  let plan = saved.plan;
  const savedApprovalPolicy = saved.approvalPolicy ?? resolveApprovalPolicy(task, rules, plan.writeTargets ?? [], {
    changedPathCount: plan.writeTargets?.length ?? 0,
    generatedFileCount: saved.result?.files?.length ?? 0
  });
  let skippedFiles: string[] = saved.skippedContextFiles ?? [];
  let iterationResults: IterationResult[] = Array.isArray(saved.iterations) ? [...saved.iterations] : [];
  let currentResult: FileGenerationResult | null = saved.result ?? null;
  let acceptedIssues: ReviewIssue[] = Array.isArray(saved.finalIssues) ? saved.finalIssues : [];
  let latestReviewSummary = typeof saved.latestReviewSummary === "string" ? saved.latestReviewSummary : "";
  const pauseAfterGenerate = saved.pauseAfterGenerate === true;
  const externalTask = saved.externalTask ?? null;
  const externalUpdatePreviews = saved.externalUpdatePreviews ?? [];
  const artifactState = restoreArtifactState(repoRoot, rules, saved.artifacts, statePath);
  const executionMachine = createExecutionStateMachine(artifactState, saved.execution ?? null, host.logger);
  if (saved.status === "paused_after_plan") {
    plan = await loadEditablePlanCheckpoint(artifactState.stepPaths.plan, plan, repoRoot, rules, host.logger);
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
        host.logger
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
        logger: host.logger
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
    host.logger
  );
  const runtime = implementationRouting.runtime;

  const localConfirmCheckpoint = (message: string, artifactPath?: string | null) =>
    host.confirmationHandler
      ? host.confirmationHandler.confirmCheckpoint(message, artifactPath)
      : confirmCheckpoint({ message, artifactPath, logger: host.logger, signal });

  const memoryStats: MemoryStats = {
    backend: runtime.memory.id,
    planningMatches: saved.memory?.planningMatches ?? 0,
    implementationMatches: saved.memory?.implementationMatches ?? 0,
    stored: false
  };
  const implementationMemoryStep = await executionMachine.runStage(
    "implementation-memory",
    async () => await loadImplementationMemoryContext(runtime.memory, task, plan, memoryStats, host.logger),
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
      async () => await readAndPersistContext(repoRoot, plan, rules, artifactState, host.logger),
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
      approvalPolicy: savedApprovalPolicy,
      externalTask,
      externalUpdatePreviews,
      logger: host.logger
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
      approvalPolicy: savedApprovalPolicy,
      externalTask,
      externalUpdatePreviews,
      logger: host.logger
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
    logger: host.logger,
    confirmCheckpoint: localConfirmCheckpoint,
    resumeFromStage: resumeStrategy.resumeFromStage,
    successResultStatus: "resumed_completed",
    successPersistedStatus: "resumed_completed",
    budgetConfig: rules.execution?.budgets,
    approvalPolicy: savedApprovalPolicy,
    externalTask,
    externalUpdatePreviews,
    signal
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
    approvalPolicy: savedApprovalPolicy,
    logger: host.logger
  });
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
