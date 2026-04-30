import type { AuditEvent } from "./audit-log.js";
import type { QueueJob } from "./job-queue.js";
import type { PersistedRunState } from "./artifacts.js";

/**
 * Normalizes an older or malformed PersistedRunState into the current schema.
 */
export function normalizePersistedRunState(raw: any): PersistedRunState {
  const state: PersistedRunState = {
    version: raw.version ?? 1,
    status: raw.status,
    task: raw.task,
    dryRun: raw.dryRun,
    plan: raw.plan ?? { prompt: "", readFiles: [], writeTargets: [], notes: [] },
    result: raw.result,
    iterations: Array.isArray(raw.iterations) ? raw.iterations : [],
    skippedContextFiles: raw.skippedContextFiles ?? [],
    finalIssues: raw.finalIssues ?? [],
    latestReviewSummary: raw.latestReviewSummary,
    pauseAfterGenerate: raw.pauseAfterGenerate,
    memory: raw.memory,
    artifacts: raw.artifacts,
    diffSummaries: raw.diffSummaries,
    latestToolResults: raw.latestToolResults,
    latestVectorMatches: raw.latestVectorMatches,
    latestContextRanking: raw.latestContextRanking,
    execution: raw.execution,
    approvalPolicy: raw.approvalPolicy,
    executionTransitions: raw.executionTransitions,
    externalTask: raw.externalTask,
    externalUpdatePreviews: raw.externalUpdatePreviews,
    refactorAnalysis: raw.refactorAnalysis,
    contracts: raw.contracts
  };

  if (state.execution?.failure) {
    state.execution.failure.class = normalizeFailureClass(state.execution.failure.class);
  }

  return state;
}

/**
 * Normalizes an older or malformed QueueJob into the current schema.
 */
export function normalizeQueueJob(raw: any): QueueJob {
  return {
    ...raw,
    version: raw.version ?? 1,
    status: raw.status ?? "failed",
    task: raw.task ?? "unknown task",
    cwd: raw.cwd ?? ".",
    dryRun: raw.dryRun ?? false,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString()
  };
}

/**
 * Normalizes an older or malformed AuditEvent into the current schema.
 */
export function normalizeAuditEvent(raw: any): AuditEvent {
  return {
    ...raw,
    version: raw.version ?? 1,
    id: raw.id ?? `unknown-${Date.now()}`,
    timestamp: raw.timestamp ?? new Date().toISOString(),
    action: raw.action ?? "unknown",
    actor: raw.actor ?? { id: "unknown", role: "viewer" }
  };
}

function normalizeFailureClass(failureClass: string): any {
  const mapping: Record<string, string> = {
    provider_timeout: "provider-timeout",
    provider_error: "provider-error",
    tool_execution_failed: "tool-execution-failed",
    context_overflow: "context-overflow",
    budget_exceeded: "cost-budget-exceeded",
    validation_failed: "validation-failed",
    user_cancelled: "user-cancelled",
    internal_error: "internal-error"
  };
  return mapping[failureClass] ?? failureClass;
}
