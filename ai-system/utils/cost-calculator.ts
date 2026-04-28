import { estimateTokenCount } from "./string.js";
import type {
  ContextFile,
  ExecutionBudgetSummary,
  PlanResult,
  ProviderRole,
  ProviderSummary,
  ProviderUsageMetric,
  RulesConfig
} from "../types.js";

export const PROVIDER_TOKEN_COST_UNITS: Record<string, number> = {
  "codex-cli": 0.01,
  "gemini-cli": 0.015,
  "claude-cli": 0.03,
  "openai-compatible": 0.02
};

export interface ProviderCostInput {
  role: ProviderRole;
  provider: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
}

export interface RunCostEstimate {
  usageMetrics: ProviderUsageMetric[];
  budget: ExecutionBudgetSummary | null;
}

export function estimateProviderCost({
  role,
  provider,
  promptTokens,
  completionTokens
}: ProviderCostInput): ProviderUsageMetric {
  const totalTokens = Math.max(0, promptTokens) + Math.max(0, completionTokens);
  const costPer1k = PROVIDER_TOKEN_COST_UNITS[provider] ?? PROVIDER_TOKEN_COST_UNITS["openai-compatible"] ?? 0.02;
  return {
    role,
    provider,
    promptTokens: Math.max(0, promptTokens),
    completionTokens: Math.max(0, completionTokens),
    totalTokens,
    estimatedCostUnits: Number(((totalTokens / 1000) * costPer1k).toFixed(6))
  };
}

export function estimateRunCostFromPlan({
  task,
  plan,
  contextFiles,
  providerSummary,
  rules
}: {
  task: string;
  plan: PlanResult;
  contextFiles: ContextFile[];
  providerSummary: ProviderSummary;
  rules: RulesConfig;
}): RunCostEstimate {
  const taskTokens = estimateTokenCount(task);
  const planTokens = estimateTokenCount(JSON.stringify(plan));
  const contextTokens = contextFiles.reduce((total, file) => total + estimateTokenCount(file.content), 0);
  const toolAndReviewTokens = Math.max(200, Math.ceil((planTokens + contextTokens) * 0.35));
  const generatedTokens = Math.max(200, Math.ceil(contextTokens * 0.25));

  const usageMetrics = [
    estimateProviderCost({
      role: "generator",
      provider: providerSummary.generator,
      promptTokens: taskTokens + planTokens + contextTokens,
      completionTokens: generatedTokens
    }),
    estimateProviderCost({
      role: "reviewer",
      provider: providerSummary.reviewer,
      promptTokens: taskTokens + planTokens + contextTokens + generatedTokens,
      completionTokens: toolAndReviewTokens
    })
  ];

  const maxDurationMs = normalizeBudgetNumber(rules.execution?.budgets?.max_duration_ms);
  const maxCostUnits = normalizeBudgetNumber(rules.execution?.budgets?.max_cost_units);
  if (maxDurationMs === null && maxCostUnits === null) {
    return { usageMetrics, budget: null };
  }

  const totalCostUnits = Number(
    usageMetrics.reduce((total, metric) => total + Math.max(0, metric.estimatedCostUnits || 0), 0).toFixed(3)
  );
  return {
    usageMetrics,
    budget: {
      maxDurationMs,
      maxCostUnits,
      totalDurationMs: 0,
      totalCostUnits,
      exceeded: maxCostUnits !== null && totalCostUnits > maxCostUnits ? "cost" : null
    }
  };
}

function normalizeBudgetNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
