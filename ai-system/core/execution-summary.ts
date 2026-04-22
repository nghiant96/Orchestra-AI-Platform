import type {
  ExecutionStepStatus,
  ExecutionStepSummary,
  ExecutionSummary,
  FailureSummary,
  IterationResult,
  ReviewIssue,
  RunStatus,
  ToolExecutionResult
} from "../types.js";
import { hasBlockingIssues } from "./reviewer.js";

export function recordExecutionStep(
  steps: ExecutionStepSummary[],
  name: string,
  durationMs: number,
  status: ExecutionStepStatus,
  detail?: string
): void {
  steps.push({
    name,
    durationMs: Math.max(0, Math.round(durationMs)),
    status,
    ...(detail ? { detail } : {})
  });
}

export async function measureExecutionStep<T>(
  steps: ExecutionStepSummary[],
  name: string,
  action: () => Promise<T>,
  detail?: string
): Promise<{ result: T; durationMs: number }> {
  const startedAt = Date.now();
  try {
    const result = await action();
    const durationMs = Date.now() - startedAt;
    recordExecutionStep(steps, name, durationMs, "completed", detail);
    return { result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const normalized = error as Error;
    recordExecutionStep(steps, name, durationMs, "failed", normalized.message);
    throw error;
  }
}

export function buildExecutionSummary({
  status,
  steps,
  finalIssues = [],
  latestToolResults = [],
  iterations = []
}: {
  status?: RunStatus | string;
  steps?: ExecutionStepSummary[];
  finalIssues?: ReviewIssue[];
  latestToolResults?: ToolExecutionResult[];
  iterations?: IterationResult[];
}): ExecutionSummary {
  const normalizedSteps = Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
  return {
    totalDurationMs: normalizedSteps.reduce((total, step) => total + Math.max(0, step.durationMs || 0), 0),
    steps: normalizedSteps,
    failure: classifyRunFailure({
      status,
      finalIssues,
      latestToolResults,
      iterations
    })
  };
}

function classifyRunFailure({
  status,
  finalIssues,
  latestToolResults,
  iterations
}: {
  status?: RunStatus | string;
  finalIssues: ReviewIssue[];
  latestToolResults: ToolExecutionResult[];
  iterations: IterationResult[];
}): FailureSummary | null {
  if (status === "completed" || status === "resumed_completed") {
    return null;
  }

  if (status === "cancelled") {
    return {
      class: "cancelled",
      reason: "Run cancelled by user before implementation completed."
    };
  }

  if (status === "paused_after_plan") {
    return {
      class: "paused",
      reason: "Run paused after the plan checkpoint."
    };
  }

  if (status === "paused_after_generate") {
    return {
      class: "paused",
      reason: "Run paused after a generation checkpoint."
    };
  }

  const failedTools = latestToolResults.filter((tool) => !tool.skipped && !tool.ok);
  if (failedTools.length > 0) {
    return {
      class: "tool-check-failed",
      reason: `Tool checks failed: ${failedTools.map((tool) => tool.name).join(", ")}.`
    };
  }

  const blockingValidationIssues = finalIssues.filter(
    (issue) => issue.category === "validation" && (issue.severity === "high" || issue.severity === "medium")
  );
  if (blockingValidationIssues.length > 0) {
    return {
      class: "validation-failed",
      reason: `Generated output failed validation with ${blockingValidationIssues.length} blocking issue(s).`
    };
  }

  if (status === "failed" && hasBlockingIssues(finalIssues)) {
    return {
      class: "iteration-limit",
      reason: `Run ended with blocking issues after ${iterations.length} iteration(s).`
    };
  }

  if (hasBlockingIssues(finalIssues)) {
    return {
      class: "review-blocking-issues",
      reason: `Blocking review issues remained at the end of the run.`
    };
  }

  if (status === "failed") {
    return {
      class: "unknown",
      reason: "Run failed without a classified tool or review cause."
    };
  }

  return null;
}
