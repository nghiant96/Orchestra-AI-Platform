import fs from "node:fs/promises";
import path from "node:path";
import type {
  PlanResult,
  ProviderRole,
  ProviderRoutingProfile,
  RoutingConfig,
  RoutingDecision,
  RoutingProfileName,
  RoutingSignal,
  RulesConfig
} from "../types.js";

const PROFILE_NAMES: RoutingProfileName[] = ["fast", "balanced", "safe"];
const PROVIDER_ROLES: ProviderRole[] = ["planner", "reviewer", "generator", "fixer"];
const ADAPTIVE_ROLE_ORDER: Record<"planning" | "implementation", ProviderRole[]> = {
  planning: ["planner"],
  implementation: ["reviewer", "generator", "fixer"]
};
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
const DEFAULT_FAST_KEYWORDS = [
  "readme",
  "docs",
  "documentation",
  "comment",
  "comments",
  "typo",
  "wording",
  "copy",
  "text",
  "logging"
];
const DEFAULT_SAFE_KEYWORDS = [
  "auth",
  "permission",
  "security",
  "secret",
  "token",
  "credential",
  "payment",
  "billing",
  "checkout",
  "database",
  "db",
  "schema",
  "migration",
  "sql",
  "production",
  "deploy",
  "delete",
  "drop"
];
const RISKY_PATH_PATTERNS = [
  /(^|\/)auth(\/|$)/,
  /(^|\/)security(\/|$)/,
  /(^|\/)payment(\/|$)/,
  /(^|\/)billing(\/|$)/,
  /(^|\/)db(\/|$)/,
  /(^|\/)database(\/|$)/,
  /(^|\/)migrations?(\/|$)/,
  /(^|\/)prisma(\/|$)/,
  /schema\.prisma$/,
  /\.sql$/,
  /docker/i,
  /(^|\/)infra(\/|$)/,
  /(^|\/)deploy(\/|$)/,
  /(^|\/)\.github\//,
  /(^|\/)workflows\//
];
const DOC_PATH_PATTERNS = [/\.mdx?$/i, /(^|\/)docs(\/|$)/i, /(^|\/)README/i, /(^|\/)CHANGELOG/i];
const REPO_SIGNAL_FILES: Array<{ file: string; signal: RoutingSignal }> = [
  {
    file: "prisma/schema.prisma",
    signal: {
      name: "repo:prisma",
      matched: true,
      details: "Repository contains Prisma schema.",
      scores: { safe: 2 }
    }
  },
  {
    file: "docker-compose.yml",
    signal: {
      name: "repo:docker-compose",
      matched: true,
      details: "Repository contains docker-compose.yml.",
      scores: { safe: 1, balanced: 1 }
    }
  },
  {
    file: "Dockerfile",
    signal: {
      name: "repo:dockerfile",
      matched: true,
      details: "Repository contains Dockerfile.",
      scores: { safe: 1 }
    }
  },
  {
    file: "pnpm-lock.yaml",
    signal: {
      name: "repo:pnpm-workspace",
      matched: true,
      details: "Repository uses pnpm.",
      scores: { balanced: 1 }
    }
  },
  {
    file: "tsconfig.json",
    signal: {
      name: "repo:typescript",
      matched: true,
      details: "Repository contains tsconfig.json.",
      scores: { balanced: 1 }
    }
  }
];
const DEFAULT_ROUTING_PROFILES: Record<RoutingProfileName, ProviderRoutingProfile> = {
  fast: {
    planner: "gemini-cli",
    reviewer: "codex-cli",
    generator: "codex-cli",
    fixer: "codex-cli"
  },
  balanced: {
    planner: "gemini-cli",
    reviewer: "gemini-cli",
    generator: "codex-cli",
    fixer: "codex-cli"
  },
  safe: {
    planner: "gemini-cli",
    reviewer: "claude-cli",
    generator: "codex-cli",
    fixer: "codex-cli"
  }
};

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

export async function buildRoutingDecision({
  repoRoot,
  rules,
  task,
  stage,
  plan,
  forcedProfile
}: {
  repoRoot: string;
  rules: RulesConfig;
  task?: string;
  stage: "planning" | "implementation";
  plan?: PlanResult | null;
  forcedProfile?: RoutingProfileName;
}): Promise<RoutingDecision> {
  const routing = rules.routing ?? {};
  const defaultProfile = normalizeProfileName(routing.default_profile) || "balanced";
  const enabled = normalizeBooleanEnv(process.env.AI_SYSTEM_ROUTING_ENABLED, routing.enabled ?? true);

  if (!enabled) {
    const roleProviders = resolveRoleProviders(rules, defaultProfile, stage, plan, []);
    return {
      stage,
      enabled: false,
      profile: defaultProfile,
      reason: "routing disabled",
      roleProviders,
      appliedRoles: {},
      reasons: ["Dynamic routing disabled."],
      signals: []
    };
  }

  const adaptiveInsights = await buildAdaptiveRoutingInsights({ repoRoot, rules, routing, task, stage, plan });
  const signals = await collectSignals({ repoRoot, rules, routing, task, stage, plan, adaptiveInsights });
  const forced = forcedProfile || normalizeProfileName(process.env.AI_SYSTEM_ROUTING_PROFILE) || mapRiskToProfile(process.env.AI_SYSTEM_RISK_PROFILE);
  const profile = forced || chooseProfile(defaultProfile, signals);
  const reason = forced
    ? `forced by ${forcedProfile ? "plan-aware rerouting" : process.env.AI_SYSTEM_ROUTING_PROFILE ? "AI_SYSTEM_ROUTING_PROFILE" : "AI_SYSTEM_RISK_PROFILE"}`
    : signals.find((signal) => signal.matched && signal.scores?.[profile])?.details || "score-based routing";
  const roleProviders = applyAdaptiveRoleRecommendations(
    resolveRoleProviders(rules, profile, stage, plan, signals),
    rules,
    stage,
    adaptiveInsights
  );

  return {
    stage,
    enabled: true,
    profile,
    reason,
    roleProviders,
    appliedRoles: {},
    reasons: signals.filter((signal) => signal.matched).map((signal) => signal.details || signal.name),
    signals
  };
}

export function chooseProfile(defaultProfile: RoutingProfileName, signals: RoutingSignal[]): RoutingProfileName {
  const scores = createScoreCard(defaultProfile);

  for (const signal of signals) {
    if (!signal.matched || !signal.scores) {
      continue;
    }

    for (const profile of PROFILE_NAMES) {
      scores[profile] += signal.scores[profile] ?? 0;
    }
  }

  let winner = defaultProfile;
  let winnerScore = scores[winner];
  for (const profile of PROFILE_NAMES) {
    if (scores[profile] > winnerScore) {
      winner = profile;
      winnerScore = scores[profile];
    }
  }

  return winner;
}

export function resolveRoleProviders(
  rules: RulesConfig,
  profileName: RoutingProfileName,
  stage: "planning" | "implementation",
  plan: PlanResult | null | undefined,
  signals: RoutingSignal[]
): Record<ProviderRole, string> {
  const profile = getRoutingProfile(rules, profileName);
  const roleProviders = createRoleProviders(profile, rules);

  if (stage === "implementation") {
    const docsOnly = signals.some((signal) => signal.name === "plan:docs-only" && signal.matched);
    const riskyPlan = signals.some((signal) => signal.name === "plan:risky-paths" && signal.matched);
    const writeCount = plan?.writeTargets?.length ?? 0;

    if (docsOnly) {
      roleProviders.reviewer = resolvePreferredProviderType(rules, ["codex-cli", roleProviders.reviewer]);
    } else if (riskyPlan || writeCount > 3) {
      roleProviders.reviewer = resolvePreferredProviderType(rules, ["claude-cli", roleProviders.reviewer]);
    }
  }

  return roleProviders;
}

export function getRoutingProfile(rules: RulesConfig, profileName: RoutingProfileName): ProviderRoutingProfile {
  return {
    ...DEFAULT_ROUTING_PROFILES[profileName],
    ...(rules.routing?.profiles?.[profileName] ?? {})
  };
}

async function collectSignals({
  repoRoot,
  rules: _rules,
  routing,
  task,
  stage,
  plan,
  adaptiveInsights
}: {
  repoRoot: string;
  rules: RulesConfig;
  routing: RoutingConfig;
  task?: string;
  stage: "planning" | "implementation";
  plan?: PlanResult | null;
  adaptiveInsights: AdaptiveRoutingInsights;
}): Promise<RoutingSignal[]> {
  const signals: RoutingSignal[] = [];
  signals.push(...buildTaskSignals(task, routing));
  signals.push(...(await buildRepoSignals(repoRoot)));
  signals.push(...adaptiveInsights.signals);

  if (stage === "implementation") {
    signals.push(...buildPlanSignals(plan));
  }

  return signals;
}

async function buildAdaptiveRoutingInsights({
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

function buildTaskSignals(task: string | undefined, routing: RoutingConfig): RoutingSignal[] {
  const normalizedTask = String(task || "").trim().toLowerCase();
  if (!normalizedTask) {
    return [];
  }

  const fastKeywords = collectRoutingKeywords(routing, "fast", DEFAULT_FAST_KEYWORDS);
  const safeKeywords = collectRoutingKeywords(routing, "safe", DEFAULT_SAFE_KEYWORDS);
  const matchedFast = fastKeywords.filter((keyword) => normalizedTask.includes(keyword));
  const matchedSafe = safeKeywords.filter((keyword) => normalizedTask.includes(keyword));
  const signals: RoutingSignal[] = [];

  if (matchedFast.length > 0) {
    signals.push({
      name: "task:fast-keywords",
      matched: true,
      details: `Task matches low-risk keywords: ${matchedFast.join(", ")}.`,
      scores: { fast: 3 }
    });
  }
  if (matchedSafe.length > 0) {
    signals.push({
      name: "task:safe-keywords",
      matched: true,
      details: `Task matches high-risk keywords: ${matchedSafe.join(", ")}.`,
      scores: { safe: 4 }
    });
  }

  return signals;
}

async function buildRepoSignals(repoRoot: string): Promise<RoutingSignal[]> {
  const signals: RoutingSignal[] = [];

  for (const entry of REPO_SIGNAL_FILES) {
    try {
      await fs.access(path.join(repoRoot, entry.file));
      signals.push(entry.signal);
    } catch {
      continue;
    }
  }

  return signals;
}

function buildPlanSignals(plan: PlanResult | null | undefined): RoutingSignal[] {
  if (!plan) {
    return [];
  }

  const paths = [...(plan.readFiles ?? []), ...(plan.writeTargets ?? [])].map((value) => String(value || ""));
  const writeTargets = plan.writeTargets ?? [];
  const signals: RoutingSignal[] = [];

  if (writeTargets.length > 3) {
    signals.push({
      name: "plan:many-writes",
      matched: true,
      details: `Plan writes ${writeTargets.length} files.`,
      scores: { safe: 2, balanced: 1 }
    });
  }

  const riskyPaths = writeTargets.filter((filePath) => isRiskyPath(filePath));
  if (riskyPaths.length > 0) {
    signals.push({
      name: "plan:risky-paths",
      matched: true,
      details: `Plan targets risky paths: ${riskyPaths.join(", ")}.`,
      scores: { safe: 4 }
    });
  }

  const docsOnly = paths.length > 0 && paths.every((filePath) => isDocumentationPath(filePath));
  if (docsOnly) {
    signals.push({
      name: "plan:docs-only",
      matched: true,
      details: "Plan only touches documentation-style files.",
      scores: { fast: 3 }
    });
  }

  const configPaths = writeTargets.filter((filePath) => looksLikeConfigPath(filePath));
  if (configPaths.length > 0) {
    signals.push({
      name: "plan:config-paths",
      matched: true,
      details: `Plan updates config or infrastructure files: ${configPaths.join(", ")}.`,
      scores: { safe: 2 }
    });
  }

  return signals;
}

function createScoreCard(defaultProfile: RoutingProfileName): Record<RoutingProfileName, number> {
  return {
    fast: defaultProfile === "fast" ? 1 : 0,
    balanced: defaultProfile === "balanced" ? 1 : 0,
    safe: defaultProfile === "safe" ? 1 : 0
  };
}

function createRoleProviders(profile: ProviderRoutingProfile, rules: RulesConfig): Record<ProviderRole, string> {
  return {
    planner: resolvePreferredProviderType(rules, [profile.planner, rules.providers.planner.type]),
    reviewer: resolvePreferredProviderType(rules, [profile.reviewer, rules.providers.reviewer.type]),
    generator: resolvePreferredProviderType(rules, [profile.generator, rules.providers.generator.type]),
    fixer: resolvePreferredProviderType(rules, [profile.fixer, rules.providers.fixer.type])
  };
}

function applyAdaptiveRoleRecommendations(
  roleProviders: Record<ProviderRole, string>,
  rules: RulesConfig,
  stage: "planning" | "implementation",
  insights: AdaptiveRoutingInsights
): Record<ProviderRole, string> {
  const adaptive: AdaptiveRoutingConfigShape = {
    ...DEFAULT_ADAPTIVE_CONFIG,
    ...(rules.routing?.adaptive ?? {})
  };
  const nextProviders = { ...roleProviders };
  const availableProviders = [...new Set(Object.values(rules.providers).map((provider) => normalizeProviderType(provider?.type)).filter(Boolean))];

  for (const role of ADAPTIVE_ROLE_ORDER[stage]) {
    const roleStatMap = insights.roleStats[role];
    if (!roleStatMap) {
      continue;
    }

    const currentProvider = normalizeProviderType(nextProviders[role]);
    const currentScore = roleStatMap[currentProvider]?.score ?? 0;
    const currentSamples = roleStatMap[currentProvider]?.samples ?? 0;
    let bestProvider = currentProvider;
    let bestScore = currentScore;

    for (const providerType of availableProviders) {
      const stat = roleStatMap[providerType];
      if (!stat || stat.samples < adaptive.min_samples) {
        continue;
      }
      if (stat.score > bestScore) {
        bestProvider = providerType;
        bestScore = stat.score;
      }
    }

    if (
      bestProvider &&
      bestProvider !== currentProvider &&
      bestScore >= currentScore + adaptive.role_override_threshold &&
      (roleStatMap[bestProvider]?.samples ?? 0) >= adaptive.min_samples &&
      hasProviderTemplate(rules, bestProvider)
    ) {
      nextProviders[role] = bestProvider;
    }

    if (!currentProvider && currentSamples === 0) {
      continue;
    }
  }

  return nextProviders;
}

function resolvePreferredProviderType(rules: RulesConfig, candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const normalized = normalizeProviderType(candidate);
    if (normalized && hasProviderTemplate(rules, normalized)) {
      return normalized;
    }
  }

  return normalizeProviderType(candidates[0]) || "gemini-cli";
}

function hasProviderTemplate(rules: RulesConfig, providerType: string): boolean {
  return Object.values(rules.providers).some((provider) => provider?.type === providerType);
}

function collectRoutingKeywords(routing: RoutingConfig, profileName: "fast" | "safe", fallback: string[]): string[] {
  const configured = routing.heuristics?.[profileName];
  if (!Array.isArray(configured)) {
    return fallback;
  }

  const normalized = configured.map((keyword) => String(keyword).trim().toLowerCase()).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
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
  const roles = ADAPTIVE_ROLE_ORDER[stage];
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

function isRiskyPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return RISKY_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isDocumentationPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return DOC_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeConfigPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return /(^|\/)(package\.json|tsconfig\.json|docker-compose\.yml|Dockerfile|\.github\/workflows\/)/i.test(normalized);
}

function classifyRoutingCategory(task: string | undefined, plan: PlanResult | null | undefined): "docs" | "risky" | "general" {
  const normalizedTask = String(task || "").trim().toLowerCase();
  const paths = [...(plan?.readFiles ?? []), ...(plan?.writeTargets ?? [])].map((value) => String(value || ""));
  const docsTask = DEFAULT_FAST_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));
  const riskyTask = DEFAULT_SAFE_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));
  const docsPaths = paths.length > 0 && paths.every((filePath) => isDocumentationPath(filePath));
  const riskyPaths = paths.some((filePath) => isRiskyPath(filePath) || looksLikeConfigPath(filePath));

  if (riskyTask || riskyPaths) {
    return "risky";
  }
  if (docsTask || docsPaths) {
    return "docs";
  }
  return "general";
}

function normalizePath(filePath: string): string {
  return String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function normalizeProfileName(value?: string): RoutingProfileName | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (PROFILE_NAMES.includes(normalized as RoutingProfileName)) {
    return normalized as RoutingProfileName;
  }
  return null;
}

function mapRiskToProfile(value?: string): RoutingProfileName | null {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "low":
      return "fast";
    case "medium":
      return "balanced";
    case "high":
      return "safe";
    default:
      return normalizeProfileName(normalized);
  }
}

function normalizeProviderType(value?: string): string {
  return String(value || "").trim().toLowerCase();
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

function normalizeBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (typeof value === "undefined") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) {
    return true;
  }
  return fallback;
}
