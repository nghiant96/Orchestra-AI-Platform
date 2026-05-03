import type {
  ApprovalPolicyDecision,
  ExecutionBudgetConfig,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  RetryHint,
  RunStatus,
  Logger
} from "../types.js";
import { summarizeIssueCounts } from "./reviewer.js";
import { reconcileTestPlan } from "./test-reconciliation.js";
import {
  persistRunState,
  finalizeArtifactState,
  type ArtifactState
} from "./artifacts.js";
import { buildExecutionSummary } from "./execution-summary.js";
import { writeFilesAtomically, readOriginalFiles } from "./context.js";
import { collectProviderUsageMetrics, safelyStoreMemory } from "./run-executor-utils.js";
import type { LoopExecutionState, RuntimeDependencies } from "./run-executor-types.js";

export async function finalizeSuccessfulRun({
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
  state,
  startAtStage,
  resultStatus,
  persistedStatus,
  budgetConfig,
  approvalPolicy = null,
  externalTask = null,
  externalUpdatePreviews: _externalUpdatePreviews = [],
  logger
}: {
  task: string;
  dryRun: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  skippedFiles: string[];
  runtime: RuntimeDependencies;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
  state: LoopExecutionState;
  startAtStage?: "write-files" | "memory-store";
  resultStatus?: RunStatus;
  persistedStatus: RunStatus;
  budgetConfig?: ExecutionBudgetConfig | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
  logger: Logger;
}): Promise<OrchestratorResult> {
  if (!state.currentResult) {
    throw new Error("Missing generation result while finalizing success.");
  }

  const originals = await readOriginalFiles(repoRoot, state.currentResult.files.map((file) => file.path));
  if (!dryRun && startAtStage !== "memory-store") {
    logger.step("Writing files atomically");
    await state.executionMachine.runStage(
      "write-files",
      async () => {
        await writeFilesAtomically(repoRoot, state.currentResult?.files ?? [], originals);
      },
      { detail: `${state.currentResult.files.length} file(s) written.` }
    );
  } else if (startAtStage !== "memory-store") {
    await state.executionMachine.skipStage("write-files", {
      durationMs: 0,
      detail: "Dry run skipped file writes."
    });
  }

  const memoryStore = await state.executionMachine.runStage(
    "memory-store",
    async () =>
      await safelyStoreMemory(
        runtime.memory,
        {
          task,
          plan,
          result: state.currentResult,
          iterations: state.iterationResults,
          issueCounts: summarizeIssueCounts(state.acceptedIssues),
          providers: runtime.providerSummary,
          success: true,
          dryRun
        },
        logger
      ),
    {
      detail: "Persisted successful run summary to memory."
    }
  );
  memoryStats.stored = memoryStore.result;
  await state.executionMachine.completeStage("success", {
    durationMs: 0,
    detail: "Run completed successfully."
  });

  const execution = buildExecutionSummary({
    status: resultStatus ?? persistedStatus,
    steps: state.executionMachine.getSteps(),
    transitions: state.executionMachine.getTransitions(),
    providers: runtime.providerSummary,
    budgetConfig,
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults,
    usageMetrics: collectProviderUsageMetrics(runtime),
    retryHint: null
  });

  const result: OrchestratorResult = {
    version: 1,
    ok: true,
    ...(resultStatus ? { status: resultStatus } : {}),
    dryRun,
    repoRoot,
    configPath,
    plan,
    result: state.currentResult,
    iterations: state.iterationResults,
    issueCounts: summarizeIssueCounts(state.acceptedIssues),
    skippedContextFiles: skippedFiles,
    finalIssues: state.acceptedIssues,
    providers: runtime.providerSummary,
    memory: memoryStats,
    artifacts: finalizeArtifactState(artifactState, state.currentResult, true, state.latestToolResults, [], [], execution),
    diffSummaries: state.diffSummaries,
    latestToolResults: state.latestToolResults,
    missingTests: [
      ...reconcileTestPlan(plan.testPlan, state.latestToolResults),
      ...(state.iterationResults.at(-1)?.missingTests ?? [])
    ],
    execution,
    approvalPolicy,
    externalTask: externalTask ?? undefined,
    refactorAnalysis: plan.refactorAnalysis,
    wroteFiles: !dryRun
  };

  await persistRunState(
    artifactState,
    {
      ...result,
      status: persistedStatus,
      task,
      pauseAfterPlan,
      pauseAfterGenerate,
      latestReviewSummary: state.latestReviewSummary,
      latestToolResults: state.latestToolResults,
      execution,
      approvalPolicy,
      executionTransitions: state.executionMachine.getTransitions()
    },
    logger
  );

  return result;
}

export async function finalizeFailedRun({
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
  state,
  retryHint,
  startAtStage: _startAtStage,
  resultStatus,
  persistedStatus,
  budgetConfig,
  approvalPolicy = null,
  externalTask = null,
  additionalUsageMetrics = [],
  logger
}: {
  task: string;
  dryRun: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  skippedFiles: string[];
  runtime: RuntimeDependencies;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
  state: LoopExecutionState;
  retryHint?: RetryHint | null;
  startAtStage?: "memory-store";
  resultStatus?: RunStatus;
  persistedStatus: RunStatus;
  budgetConfig?: ExecutionBudgetConfig | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
  additionalUsageMetrics?: import("../types.js").ProviderUsageMetric[];
  logger: Logger;
}): Promise<OrchestratorResult> {
  const memoryStore = await state.executionMachine.runStage(
    "memory-store",
    async () =>
      await safelyStoreMemory(
        runtime.memory,
        {
          task,
          plan,
          result: state.currentResult,
          iterations: state.iterationResults,
          issueCounts: summarizeIssueCounts(state.acceptedIssues),
          providers: runtime.providerSummary,
          success: false,
          dryRun
        },
        logger
      ),
    {
      detail: "Persisted failed run summary to memory."
    }
  );
  memoryStats.stored = memoryStore.result;
  await state.executionMachine.completeStage("failure", {
    durationMs: 0,
    detail: "Run finished with blocking issues or failed checks."
  });

  const execution = buildExecutionSummary({
    status: resultStatus ?? persistedStatus,
    steps: state.executionMachine.getSteps(),
    transitions: state.executionMachine.getTransitions(),
    providers: runtime.providerSummary,
    budgetConfig,
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults,
    usageMetrics: [...collectProviderUsageMetrics(runtime), ...(additionalUsageMetrics ?? [])],
    retryHint
  });

  const result: OrchestratorResult = {
    version: 1,
    ok: false,
    ...(resultStatus ? { status: resultStatus } : {}),
    dryRun,
    repoRoot,
    configPath,
    plan,
    result: state.currentResult,
    iterations: state.iterationResults,
    issueCounts: summarizeIssueCounts(state.acceptedIssues),
    skippedContextFiles: skippedFiles,
    finalIssues: state.acceptedIssues,
    providers: runtime.providerSummary,
    memory: memoryStats,
    artifacts: finalizeArtifactState(artifactState, state.currentResult, false, state.latestToolResults, [], [], execution),
    diffSummaries: state.diffSummaries,
    latestToolResults: state.latestToolResults,
    missingTests: [
      ...reconcileTestPlan(plan.testPlan, state.latestToolResults),
      ...(state.iterationResults.at(-1)?.missingTests ?? [])
    ],
    execution,
    approvalPolicy,
    externalTask: externalTask ?? undefined,
    refactorAnalysis: plan.refactorAnalysis,
    wroteFiles: false
  };

  await persistRunState(
    artifactState,
    {
      ...result,
      status: persistedStatus,
      task,
      pauseAfterPlan,
      pauseAfterGenerate,
      latestReviewSummary: state.latestReviewSummary,
      latestToolResults: state.latestToolResults,
      execution,
      approvalPolicy,
      executionTransitions: state.executionMachine.getTransitions()
    },
    logger
  );

  return result;
}

export async function finalizeErroredRun({
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
  state,
  retryHint,
  budgetConfig,
  approvalPolicy = null,
  externalTask = null,
  externalUpdatePreviews: _externalUpdatePreviews = [],
  logger
}: {
  task: string;
  dryRun: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  skippedFiles: string[];
  runtime: RuntimeDependencies;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
  state: LoopExecutionState;
  retryHint: RetryHint;
  budgetConfig?: ExecutionBudgetConfig | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
  logger: Logger;
}): Promise<OrchestratorResult> {
  const execution = buildExecutionSummary({
    status: "failed",
    steps: state.executionMachine.getSteps(),
    transitions: state.executionMachine.getTransitions(),
    providers: runtime.providerSummary,
    budgetConfig,
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults,
    usageMetrics: collectProviderUsageMetrics(runtime),
    retryHint
  });

  const result: OrchestratorResult = {
    version: 1,
    ok: false,
    status: "failed",
    dryRun,
    repoRoot,
    configPath,
    plan,
    result: state.currentResult,
    iterations: state.iterationResults,
    issueCounts: summarizeIssueCounts(state.acceptedIssues),
    skippedContextFiles: skippedFiles,
    finalIssues: state.acceptedIssues,
    providers: runtime.providerSummary,
    memory: memoryStats,
    artifacts: finalizeArtifactState(artifactState, state.currentResult, false, state.latestToolResults, [], [], execution),
    diffSummaries: state.diffSummaries,
    latestToolResults: state.latestToolResults,
    missingTests: [
      ...reconcileTestPlan(plan.testPlan, state.latestToolResults),
      ...(state.iterationResults.at(-1)?.missingTests ?? [])
    ],
    execution,
    approvalPolicy,
    externalTask: externalTask ?? undefined,
    refactorAnalysis: plan.refactorAnalysis,
    wroteFiles: false
  };

  await persistRunState(
    artifactState,
    {
      ...result,
      task,
      pauseAfterPlan,
      pauseAfterGenerate,
      latestReviewSummary: state.latestReviewSummary,
      latestToolResults: state.latestToolResults,
      execution,
      approvalPolicy,
      executionTransitions: state.executionMachine.getTransitions()
    },
    logger
  );

  return result;
}
