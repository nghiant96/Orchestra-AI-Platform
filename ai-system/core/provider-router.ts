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

  const signals = await collectSignals({ repoRoot, routing, task, stage, plan });
  const forced = forcedProfile || normalizeProfileName(process.env.AI_SYSTEM_ROUTING_PROFILE) || mapRiskToProfile(process.env.AI_SYSTEM_RISK_PROFILE);
  const profile = forced || chooseProfile(defaultProfile, signals);
  const reason = forced
    ? `forced by ${forcedProfile ? "plan-aware rerouting" : process.env.AI_SYSTEM_ROUTING_PROFILE ? "AI_SYSTEM_ROUTING_PROFILE" : "AI_SYSTEM_RISK_PROFILE"}`
    : signals.find((signal) => signal.matched && signal.scores?.[profile])?.details || "score-based routing";
  const roleProviders = resolveRoleProviders(rules, profile, stage, plan, signals);

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
  routing,
  task,
  stage,
  plan
}: {
  repoRoot: string;
  routing: RoutingConfig;
  task?: string;
  stage: "planning" | "implementation";
  plan?: PlanResult | null;
}): Promise<RoutingSignal[]> {
  const signals: RoutingSignal[] = [];
  signals.push(...buildTaskSignals(task, routing));
  signals.push(...(await buildRepoSignals(repoRoot)));

  if (stage === "implementation") {
    signals.push(...buildPlanSignals(plan));
  }

  return signals;
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
