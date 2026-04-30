import { listRecentRunSummaries } from "./artifacts.js";
import type { FailureMetadata, RulesConfig } from "../types.js";

export function classifyServerError(error: unknown): FailureMetadata {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
    return {
      class: "provider-timeout",
      message: "AI Provider request timed out",
      retryable: true,
      suggestion: "Check your internet connection or try a faster model."
    };
  }
  if (msg.includes("rate limit") || msg.includes("429")) {
    return {
      class: "provider-error",
      message: "AI Provider rate limit exceeded",
      retryable: true,
      suggestion: "Wait a few minutes or switch to another provider."
    };
  }
  if (msg.includes("context length") || msg.includes("token limit")) {
    return {
      class: "context-overflow",
      message: "File context is too large",
      retryable: false,
      suggestion: "Try to reduce the number of files in context or use a model with larger context window."
    };
  }
  if (msg.includes("budget exceeded") || msg.includes("max cost")) {
    return {
      class: "cost-budget-exceeded",
      message: "Execution budget reached",
      retryable: false,
      suggestion: "Increase max_cost_units in system configuration."
    };
  }
  if (msg.includes("Command failed")) {
    return {
      class: "tool-execution-failed",
      message: "Build or test tool failed",
      retryable: true,
      suggestion: "Fix the syntax errors in your code and run again."
    };
  }

  return { class: "internal-error", message: msg, retryable: true, suggestion: "Check server logs for more details." };
}

export async function aggregateProjectStats(cwd: string, rules: RulesConfig) {
  const recentRuns = await listRecentRunSummaries(cwd, rules, 50);

  const stats = {
    totalProjectCost: 0,
    totalRuns: 0,
    totalIterations: 0,
    costByDay: {} as Record<string, number>,
    failuresByClass: {} as Record<string, number>,
    avgDurationByStage: {} as Record<string, { total: number; count: number }>,
    providerPerformance: {} as Record<string, { runs: number; failures: number; durationMs: number; costUnits: number; iterations: number }>,
    contractStats: {
      totalContracts: 0,
      passedContracts: 0,
      failedContracts: 0,
      byDomain: {} as Record<string, { total: number; passed: number; failed: number }>
    }
  };

  for (const run of recentRuns) {
    stats.totalRuns += 1;
    const date = (run.updatedAt || new Date().toISOString()).split("T")[0]!;
    const cost = run.execution?.budget?.totalCostUnits || 0;
    stats.totalProjectCost += cost;
    stats.costByDay[date] = (stats.costByDay[date] || 0) + cost;

    const iterations = run.iterationCount || 0;
    stats.totalIterations += iterations;

    if (run.status === "failed") {
      const error = classifyServerError(run.execution?.failure?.reason);
      stats.failuresByClass[error.class] = (stats.failuresByClass[error.class] || 0) + 1;
    }

    for (const metric of run.execution?.providerMetrics ?? []) {
      const current = stats.providerPerformance[metric.provider] || { runs: 0, failures: 0, durationMs: 0, costUnits: 0, iterations: 0 };
      current.runs += 1;
      current.failures += run.status === "failed" ? 1 : 0;
      current.durationMs += metric.totalDurationMs;
      current.costUnits += metric.estimatedCostUnits;
      current.iterations += iterations;
      stats.providerPerformance[metric.provider] = current;
    }

    if (run.contracts) {
      for (const contract of run.contracts) {
        stats.contractStats.totalContracts += 1;
        if (contract.status === "passed") stats.contractStats.passedContracts += 1;
        if (contract.status === "failed") stats.contractStats.failedContracts += 1;

        // Try to infer domain from ID or metadata
        const domain = inferContractDomain(contract);
        const current = stats.contractStats.byDomain[domain] || { total: 0, passed: 0, failed: 0 };
        current.total += 1;
        if (contract.status === "passed") current.passed += 1;
        if (contract.status === "failed") current.failed += 1;
        stats.contractStats.byDomain[domain] = current;
      }
    }

    if (run.execution?.transitions) {
      for (const transition of run.execution.transitions) {
        if (transition.status === "completed" && transition.durationMs) {
          const current = stats.avgDurationByStage[transition.stage] || { total: 0, count: 0 };
          current.total += transition.durationMs;
          current.count += 1;
          stats.avgDurationByStage[transition.stage] = current;
        }
      }
    }
  }

  return {
    version: 1,
    totalProjectCost: stats.totalProjectCost,
    totalRuns: stats.totalRuns,
    avgIterations: stats.totalRuns > 0 ? stats.totalIterations / stats.totalRuns : 0,
    costByDay: Object.entries(stats.costByDay)
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    failuresByClass: Object.entries(stats.failuresByClass).map(([name, count]) => ({ name, count })),
    avgDurationByStage: Object.entries(stats.avgDurationByStage).map(([stage, data]) => ({
      stage,
      avgMs: Math.round(data.total / data.count)
    })),
    providerPerformance: Object.entries(stats.providerPerformance)
      .map(([provider, data]) => {
        const failureRate = data.runs > 0 ? data.failures / data.runs : 0;
        return {
          provider,
          runs: data.runs,
          failureRate,
          avgDurationMs: data.runs > 0 ? Math.round(data.durationMs / data.runs) : 0,
          avgIterations: data.runs > 0 ? data.iterations / data.runs : 0,
          totalCostUnits: data.costUnits,
          degraded: failureRate > 0.3
        };
      })
      .sort((left, right) => right.runs - left.runs),
    contractStats: {
      total: stats.contractStats.totalContracts,
      passed: stats.contractStats.passedContracts,
      failed: stats.contractStats.failedContracts,
      passRate: stats.contractStats.totalContracts > 0 ? stats.contractStats.passedContracts / stats.contractStats.totalContracts : 0,
      byDomain: Object.entries(stats.contractStats.byDomain).map(([domain, data]) => ({
        domain,
        total: data.total,
        passed: data.passed,
        failed: data.failed,
        passRate: data.total > 0 ? data.passed / data.total : 0
      }))
    }
  };
}

function inferContractDomain(contract: any): string {
  const id = contract.id || "";
  if (id.includes("ui") || id.includes("event-feed")) return "ui";
  if (id.includes("api") || id.includes("schema")) return "api";
  if (id.includes("security") || id.includes("dependency")) return "security";
  if (id.includes("test") || id.includes("risky")) return "tests";
  return "other";
}
