import fs from "node:fs/promises";
import path from "node:path";
import type { PlanResult, ProviderRole, RoutingConfig, RoutingProfileName, RoutingSignal, RulesConfig } from "../types.js";
import {
  PROFILE_NAMES,
  PROVIDER_ROLES,
  createRoleProviders,
  getRoutingProfile,
  normalizeProviderType
} from "./provider-router-utils.js";
import { classifyRoutingCategory } from "./provider-router-signals.js";

const DEFAULT_ADAPTIVE_CONFIG = {
  enabled: true,
  lookback_runs: 12,
  min_samples: 2,
  failure_weight: 1.5,
  planner_weight: 1,
  reviewer_weight: 1.5,
  generator_weight: 0.75,
  fixer_weight: 0.75,
  role_override_threshold: 1.5,
  latency_weight: 0.15,
  cost_weight: 0.1,
  duration_budget_penalty: 1,
  cost_budget_penalty: 1
} as const;

interface AdaptiveRunRecord {
  task: string;
  latestFiles: string[];
  providers: Partial<Record<ProviderRole, string>>;
  providerMetrics: Partial<Record<ProviderRole, { durationMs: number; estimatedCostUnits: number }>>;
  success: boolean;
  failureClass: string | null;
  category: "docs" | "risky" | "general";
}

interface AdaptiveProviderStat {
  score: number;
  samples: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  totalCostUnits: number;
}

interface AdaptiveRoutingInsights {
  signals: RoutingSignal[];
  roleStats: Partial<Record<ProviderRole, Record<string, AdaptiveProviderStat>>>;
  category: "docs" | "risky" | "general";
  runsConsidered: number;
}

interface AdaptiveRoutingConfigShape {
  enabled: boolean;
  lookback_runs: number;
  min_samples: number;
  failure_weight: number;
  planner_weight: number;
  reviewer_weight: number;
  generator_weight: number;
  fixer_weight: number;
  role_override_threshold: number;
  latency_weight: number;
  cost_weight: number;
  duration_budget_penalty: number;
  cost_budget_penalty: number;
}

export async function buildAdaptiveRoutingInsights({
  repoRoot,
  rules,
  routing,
  task,
  stage,
  plan
}: {
  repoRoot: string;
  rules: RulesConfig;
  routing: RoutingConfig;
  task?: string;
  stage: "planning" | "implementation";
  plan?: PlanResult | null;
}): Promise<AdaptiveRoutingInsights> {
  const adaptive: AdaptiveRoutingConfigShape = {
    ...DEFAULT_ADAPTIVE_CONFIG,
    ...(routing.adaptive ?? {})
  };
  if (adaptive.enabled === false) {
    return {
      signals: [],
      roleStats: {},
      category: classifyRoutingCategory(task, plan),
      runsConsidered: 0
    };
  }

  const category = classifyRoutingCategory(task, plan);
  const history = await loadAdaptiveRunHistory(repoRoot, rules, adaptive.lookback_runs);
  const relevantRuns = history.filter((run) => run.category === category || (category === "general" && run.category === "general"));
  if (relevantRuns.length < adaptive.min_samples) {
    return {
      signals: [],
      roleStats: {},
      category,
      runsConsidered: relevantRuns.length
    };
  }

  const roleStats = buildAdaptiveRoleStats(relevantRuns, adaptive);
  const profileScores = buildAdaptiveProfileScores(rules, stage, roleStats, adaptive);
  const profileSignal = createAdaptiveProfileSignal(category, relevantRuns.length, profileScores);
  return {
    signals: profileSignal ? [profileSignal] : [],
    roleStats,
    category,
    runsConsidered: relevantRuns.length
  };
}

function buildAdaptiveRoleStats(
  runs: AdaptiveRunRecord[],
  adaptive: AdaptiveRoutingConfigShape
): Partial<Record<ProviderRole, Record<string, AdaptiveProviderStat>>> {
  const stats: Partial<Record<ProviderRole, Record<string, AdaptiveProviderStat>>> = {};

  for (const run of runs) {
    for (const role of PROVIDER_ROLES) {
      const providerType = normalizeProviderType(run.providers[role]);
      if (!providerType) {
        continue;
      }
      const roleStats = (stats[role] ??= {});
      const providerStats = (roleStats[providerType] ??= {
        score: 0,
        samples: 0,
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
        totalCostUnits: 0
      });
      const metric = run.providerMetrics[role] ?? { durationMs: 0, estimatedCostUnits: 0 };
      providerStats.samples += 1;
      providerStats.totalDurationMs += metric.durationMs;
      providerStats.totalCostUnits += metric.estimatedCostUnits;
      if (run.success) {
        providerStats.successes += 1;
        providerStats.score += 1;
      } else {
        providerStats.failures += 1;
        providerStats.score -= adaptive.failure_weight;
      }
      if (run.failureClass === "duration-budget-exceeded") {
        providerStats.score -= adaptive.duration_budget_penalty;
      }
      if (run.failureClass === "cost-budget-exceeded") {
        providerStats.score -= adaptive.cost_budget_penalty;
      }
      providerStats.score -= (metric.durationMs / 1000) * adaptive.latency_weight;
      providerStats.score -= metric.estimatedCostUnits * adaptive.cost_weight;
    }
  }

  return stats;
}

function buildAdaptiveProfileScores(
  rules: RulesConfig,
  stage: "planning" | "implementation",
  roleStats: Partial<Record<ProviderRole, Record<string, AdaptiveProviderStat>>>,
  adaptive: AdaptiveRoutingConfigShape
): Partial<Record<RoutingProfileName, number>> {
  const weights: Record<ProviderRole, number> = {
    planner: adaptive.planner_weight,
    reviewer: adaptive.reviewer_weight,
    generator: adaptive.generator_weight,
    fixer: adaptive.fixer_weight
  };
  const roles: ProviderRole[] = stage === "planning" ? ["planner"] : ["reviewer", "generator", "fixer"];
  const scores: Partial<Record<RoutingProfileName, number>> = {};

  for (const profile of PROFILE_NAMES) {
    const providers = createRoleProviders(getRoutingProfile(rules, profile), rules);
    let score = 0;
    for (const role of roles) {
      const providerType = normalizeProviderType(providers[role]);
      const stat = roleStats[role]?.[providerType];
      if (!stat || stat.samples < adaptive.min_samples) {
        continue;
      }
      score += stat.score * weights[role];
    }
    scores[profile] = score;
  }

  return scores;
}

function createAdaptiveProfileSignal(
  category: "docs" | "risky" | "general",
  runsConsidered: number,
  profileScores: Partial<Record<RoutingProfileName, number>>
): RoutingSignal | null {
  const values = PROFILE_NAMES.map((profile) => profileScores[profile] ?? 0);
  const hasMeaningfulDelta = values.some((value) => Math.abs(value) >= 0.5);
  if (!hasMeaningfulDelta) {
    return null;
  }

  return {
    name: "history:provider-outcomes",
    matched: true,
    details: `Adaptive routing used ${runsConsidered} recent ${category} run(s).`,
    scores: {
      fast: profileScores.fast ?? 0,
      balanced: profileScores.balanced ?? 0,
      safe: profileScores.safe ?? 0
    }
  };
}

async function loadAdaptiveRunHistory(repoRoot: string, rules: RulesConfig, lookbackRuns: number): Promise<AdaptiveRunRecord[]> {
  const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await fs.readdir(artifactsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const runDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
    .map((entry) => path.join(artifactsDir, entry.name))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, Math.max(lookbackRuns, 0));

  const history: AdaptiveRunRecord[] = [];
  for (const runDir of runDirs) {
    try {
      const raw = await fs.readFile(path.join(runDir, "run-state.json"), "utf8");
      const parsed = JSON.parse(raw) as {
        status?: string;
        task?: string;
        providers?: Partial<Record<ProviderRole, string>>;
        result?: { files?: Array<{ path?: string }> } | null;
        artifacts?: { latestFiles?: string[] } | null;
        execution?:
          | {
              failure?: { class?: string | null } | null;
              budget?: { exceeded?: "duration" | "cost" | null } | null;
              providerMetrics?: Array<{
                provider?: string;
                role?: ProviderRole;
                totalDurationMs?: number;
                estimatedCostUnits?: number;
              }>;
            }
          | null;
        issueCounts?: Record<string, number>;
      };
      const status = String(parsed.status || "");
      if (!status || status.startsWith("paused_") || status === "cancelled") {
        continue;
      }
      const latestFiles = parsed.result?.files?.map((file) => String(file.path || "")).filter(Boolean) ?? parsed.artifacts?.latestFiles ?? [];
      const category = classifyRoutingCategory(parsed.task, {
        prompt: parsed.task ?? "",
        readFiles: [],
        writeTargets: latestFiles,
        notes: []
      });
      const highIssues = Number(parsed.issueCounts?.high ?? 0);
      const mediumIssues = Number(parsed.issueCounts?.medium ?? 0);
      const failureClass =
        parsed.execution?.failure?.class ??
        (parsed.execution?.budget?.exceeded === "duration"
          ? "duration-budget-exceeded"
          : parsed.execution?.budget?.exceeded === "cost"
            ? "cost-budget-exceeded"
            : null);
      const success = (status === "completed" || status === "resumed_completed") && !failureClass && highIssues === 0 && mediumIssues === 0;
      const providerMetrics = Object.fromEntries(
        (parsed.execution?.providerMetrics ?? [])
          .filter((entry) => entry?.role)
          .map((entry) => [
            entry.role as ProviderRole,
            {
              durationMs: Number(entry.totalDurationMs ?? 0),
              estimatedCostUnits: Number(entry.estimatedCostUnits ?? 0)
            }
          ])
      ) as AdaptiveRunRecord["providerMetrics"];
      history.push({
        task: parsed.task ?? "",
        latestFiles,
        providers: parsed.providers ?? {},
        providerMetrics,
        success,
        failureClass,
        category
      });
    } catch {
      continue;
    }
  }

  return history;
}
