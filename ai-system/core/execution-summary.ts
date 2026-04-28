import type {
  ExecutionBudgetConfig,
  ExecutionBudgetSummary,
  ExecutionStepStatus,
  ExecutionStepSummary,
  ExecutionStage,
  ExecutionProviderMetric,
  ExecutionTransition,
  ExecutionSummary,
  FailureSummary,
  IterationResult,
  ProviderSummary,
  ProviderUsageMetric,
  RetryHint,
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
  transitions,
  currentStage,
  retryHint,
  providers,
  budgetConfig,
  finalIssues = [],
  latestToolResults = [],
  iterations = [],
  usageMetrics = []
}: {
  status?: RunStatus | string;
  steps?: ExecutionStepSummary[];
  transitions?: ExecutionTransition[];
  currentStage?: ExecutionStage | null;
  retryHint?: RetryHint | null;
  providers?: ProviderSummary | null;
  budgetConfig?: ExecutionBudgetConfig | null;
  finalIssues?: ReviewIssue[];
  latestToolResults?: ToolExecutionResult[];
  iterations?: IterationResult[];
  usageMetrics?: ProviderUsageMetric[];
}): ExecutionSummary {
  const normalizedSteps = Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
  const normalizedTransitions = Array.isArray(transitions) ? transitions.map((entry) => ({ ...entry })) : [];
  const resolvedCurrentStage = currentStage ?? deriveCurrentStage(normalizedTransitions);
  const terminalStage = deriveTerminalStage(normalizedTransitions);
  const totalDurationMs = normalizedSteps.reduce((total, step) => total + Math.max(0, step.durationMs || 0), 0);
  const providerMetrics = providers ? buildProviderMetrics(normalizedSteps, providers, usageMetrics) : [];
  const budget = buildExecutionBudgetSummary({
    totalDurationMs,
    providerMetrics,
    budgetConfig
  });
  return {
    totalDurationMs,
    steps: normalizedSteps,
    transitions: normalizedTransitions,
    currentStage: resolvedCurrentStage,
    terminalStage,
    failure: classifyRunFailure({
      status,
      budget,
      finalIssues,
      latestToolResults,
      iterations
    }),
    retryHint: retryHint ?? null,
    providerMetrics,
    budget
  };
}

export function buildExecutionBudgetSummary({
  totalDurationMs,
  providerMetrics,
  budgetConfig
}: {
  totalDurationMs: number;
  providerMetrics: ExecutionProviderMetric[];
  budgetConfig?: ExecutionBudgetConfig | null;
}): ExecutionBudgetSummary | null {
  const maxDurationMs = normalizeBudgetNumber(budgetConfig?.max_duration_ms);
  const maxCostUnits = normalizeBudgetNumber(budgetConfig?.max_cost_units);
  if (maxDurationMs === null && maxCostUnits === null) {
    return null;
  }

  const totalCostUnits = Number(
    providerMetrics.reduce((total, metric) => total + Math.max(0, metric.estimatedCostUnits || 0), 0).toFixed(3)
  );
  const exceeded =
    maxDurationMs !== null && totalDurationMs > maxDurationMs
      ? "duration"
      : maxCostUnits !== null && totalCostUnits > maxCostUnits
        ? "cost"
        : null;

  return {
    maxDurationMs,
    maxCostUnits,
    totalDurationMs: Math.max(0, Math.round(totalDurationMs)),
    totalCostUnits,
    exceeded
  };
}

function deriveCurrentStage(transitions: ExecutionTransition[]): ExecutionStage | null {
  let activeStage: ExecutionStage | null = null;
  for (const transition of transitions) {
    if (transition.status === "entered") {
      activeStage = transition.stage;
      continue;
    }
    if (activeStage === transition.stage) {
      activeStage = null;
    }
  }
  return activeStage;
}

function deriveTerminalStage(transitions: ExecutionTransition[]): ExecutionStage | null {
  for (let index = transitions.length - 1; index >= 0; index -= 1) {
    if (transitions[index]?.status !== "entered") {
      return transitions[index]?.stage ?? null;
    }
  }
  return null;
}

const STAGE_ROLE_MAP: Partial<Record<ExecutionStage, keyof ProviderSummary>> = {
  planner: "planner",
  "iteration-generate": "generator",
  "iteration-fix": "fixer",
  "iteration-review": "reviewer"
};

function buildProviderMetrics(
  steps: ExecutionStepSummary[],
  providers: ProviderSummary,
  usageMetrics: ProviderUsageMetric[]
): ExecutionProviderMetric[] {
  const metrics = new Map<string, ExecutionProviderMetric>();

  const ensureMetric = (role: ProviderUsageMetric["role"], provider: string): ExecutionProviderMetric => {
    const key = `${role}:${provider}`;
    const metric = metrics.get(key) ?? {
      provider,
      role,
      stages: [],
      totalDurationMs: 0,
      estimatedCostUnits: 0
    };
    metrics.set(key, metric);
    return metric;
  };

  for (const usage of usageMetrics) {
    const provider = usage.provider || providers[usage.role];
    if (!provider) {
      continue;
    }
    ensureMetric(usage.role, provider).estimatedCostUnits += Math.max(0, usage.estimatedCostUnits || 0);
  }

  for (const step of steps) {
    const stage = normalizeExecutionStage(step.name);
    const role = stage ? STAGE_ROLE_MAP[stage] : undefined;
    if (!stage || !role) continue;

    const providerId = providers[role];
    if (!providerId) continue;

    const metric = ensureMetric(role, providerId);
    if (!metric.stages.includes(stage)) {
      metric.stages.push(stage);
    }
    metric.totalDurationMs += Math.max(0, step.durationMs || 0);
  }

  return [...metrics.values()];
}

function normalizeExecutionStage(stepName: string): ExecutionStage | null {
  if (!stepName) {
    return null;
  }
  if (stepName.startsWith("iteration-generate")) {
    return "iteration-generate";
  }
  if (stepName.startsWith("iteration-fix")) {
    return "iteration-fix";
  }
  if (stepName.startsWith("iteration-review")) {
    return "iteration-review";
  }
  if (stepName === "planner") {
    return "planner";
  }
  return null;
}

function classifyRunFailure({
  status,
  budget,
  finalIssues,
  latestToolResults,
  iterations
}: {
  status?: RunStatus | string;
  budget?: ExecutionBudgetSummary | null;
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

  if (budget?.exceeded === "duration") {
    return {
      class: "duration-budget-exceeded",
      reason: `Run exceeded the duration budget (${budget.totalDurationMs}ms > ${budget.maxDurationMs}ms).`
    };
  }

  if (budget?.exceeded === "cost") {
    return {
      class: "cost-budget-exceeded",
      reason: `Run exceeded the cost budget (${budget.totalCostUnits.toFixed(2)} > ${budget.maxCostUnits?.toFixed(2)} units).`
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

function normalizeBudgetNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}
