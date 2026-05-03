import type {
  ApprovalPolicyDecision,
  ExecutionBudgetConfig,
  ExecutionStepSummary,
  ExecutionTransition,
  FileGenerationResult,
  IterationResult,
  MemoryStats,
  OrchestratorResult,
  ContextSelectionCandidate,
  PlanResult,
  ProviderSummary,
  ProviderUsageMetric,
  ReviewIssue,
  ToolExecutionResult,
  VectorSearchMatch,
  RunStatus
} from "../types.js";
import { buildExecutionSummary } from "./execution-summary.js";
import { summarizeIssueCounts } from "./reviewer.js";

export * from "./artifact-types.js";
export * from "./artifact-utils.js";
export * from "./artifact-persistence.js";
export * from "./artifact-query.js";

import { finalizeArtifactState } from "./artifact-persistence.js";
import type { ArtifactState } from "./artifact-types.js";

/**
 * Builds an OrchestratorResult representing a run that was stopped (e.g. paused for approval).
 */
export function buildStoppedResult({
  status,
  dryRun,
  repoRoot,
  configPath,
  plan,
  result = null,
  iterations = [],
  skippedContextFiles = [],
  finalIssues = [],
  providers,
  memoryStats,
  artifactState,
  latestToolResults = [],
  latestVectorMatches = [],
  latestContextRanking = [],
  executionSteps = [],
  executionTransitions = [],
  budgetConfig = null,
  usageMetrics = [],
  approvalPolicy = null,
  externalTask = null,
  externalUpdatePreviews = []
}: {
  status: Extract<RunStatus, "paused_after_plan" | "paused_after_generate">;
  dryRun: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  result?: FileGenerationResult | null;
  iterations?: IterationResult[];
  skippedContextFiles?: string[];
  finalIssues?: ReviewIssue[];
  providers: ProviderSummary;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
  latestToolResults?: ToolExecutionResult[];
  latestVectorMatches?: VectorSearchMatch[];
  latestContextRanking?: ContextSelectionCandidate[];
  executionSteps?: ExecutionStepSummary[];
  executionTransitions?: ExecutionTransition[];
  budgetConfig?: ExecutionBudgetConfig | null;
  usageMetrics?: ProviderUsageMetric[];
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
}): OrchestratorResult {
  const execution = buildExecutionSummary({
    status,
    steps: executionSteps,
    transitions: executionTransitions,
    budgetConfig,
    providers,
    finalIssues,
    latestToolResults,
    iterations,
    usageMetrics
  });
  return {
    version: 1,
    ok: false,
    status,
    dryRun,
    repoRoot,
    configPath,
    plan,
    result,
    iterations,
    issueCounts: summarizeIssueCounts(finalIssues),
    skippedContextFiles,
    finalIssues,
    providers,
    memory: memoryStats,
    artifacts: finalizeArtifactState(
      artifactState,
      result,
      false,
      latestToolResults,
      latestVectorMatches,
      latestContextRanking,
      execution
    ),
    latestToolResults,
    execution,
    approvalPolicy,
    externalTask: externalTask ?? undefined,
    externalUpdatePreviews,
    wroteFiles: false
  };
}
