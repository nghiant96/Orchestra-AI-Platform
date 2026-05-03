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

/**
 * Detailed pricing map (Cost per 1M tokens in USD/Units)
 * Note: These are example units.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "gemini-1.5-pro": { input: 3.5, output: 10.5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "default": { input: 2.0, output: 10.0 }
};

export const PROVIDER_DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  "codex-cli": { input: 1.0, output: 5.0 },
  "gemini-cli": { input: 0.5, output: 2.0 },
  "claude-cli": { input: 3.0, output: 15.0 },
  "openai-compatible": { input: 2.0, output: 10.0 }
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
  model,
  promptTokens,
  completionTokens
}: ProviderCostInput): ProviderUsageMetric {
  const prompt = Math.max(0, promptTokens);
  const completion = Math.max(0, completionTokens);
  const totalTokens = prompt + completion;

  // Find pricing
  const pricing = MODEL_PRICING[model || ""] || PROVIDER_DEFAULT_PRICING[provider] || MODEL_PRICING["default"];

  const estimatedCostUnits = Number(
    ((prompt / 1_000_000) * pricing.input + (completion / 1_000_000) * pricing.output).toFixed(6)
  );

  return {
    role,
    provider,
    model,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens,
    estimatedCostUnits
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

  // Rules of thumb for estimation
  const toolAndReviewTokens = Math.max(500, Math.ceil((planTokens + contextTokens) * 0.4));
  const generatedTokens = Math.max(500, Math.ceil(contextTokens * 0.3));

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

  const totalCostUnits = Number(
    usageMetrics.reduce((total, metric) => total + Math.max(0, metric.estimatedCostUnits || 0), 0).toFixed(4)
  );

  return {
    usageMetrics,
    budget: {
      maxDurationMs,
      maxCostUnits,
      totalDurationMs: 0,
      totalCostUnits,
      exceeded: maxCostUnits !== null && totalCostUnits > maxCostUnits ? "cost" : null,
      retryCount: 0,
      cumulativeCostUnits: totalCostUnits,
      maxRetries: null
    }
  };
}

function normalizeBudgetNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
