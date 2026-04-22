import fs from "node:fs/promises";
import { loadJsonIfExists, mergeConfig, resolveProjectConfigPath } from "../utils/config.js";
import type {
  Logger,
  ProviderConfig,
  ProviderRole,
  ProviderRoutingProfile,
  RoutingConfig,
  RulesConfig
} from "../types.js";
import { createRuntimeDependencies, type RuntimeDependencies } from "./run-executor.js";

const PROVIDER_ROLES: ProviderRole[] = ["planner", "reviewer", "generator", "fixer"];
const ROUTING_CONTROL_KEYS = ["timeout_ms", "retries", "base_delay_ms", "monitor_interval_ms", "temperature", "response_format"] as const;
const DEFAULT_ROUTING_PROFILES: Record<string, ProviderRoutingProfile> = {
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

export interface LoadedOrchestratorRuntime {
  rules: RulesConfig;
  configPath: string | null;
  runtime: RuntimeDependencies;
  routing: RoutingDecision;
}

export interface RoutingDecision {
  enabled: boolean;
  profile: string;
  reason: string;
  appliedRoles: Partial<Record<ProviderRole, string>>;
}

export async function loadOrchestratorRuntime({
  repoRoot,
  explicitConfigPath,
  logger,
  task
}: {
  repoRoot: string;
  explicitConfigPath?: string | null;
  logger: Logger;
  task?: string;
}): Promise<LoadedOrchestratorRuntime> {
  const { rules, configPath } = await loadRules(repoRoot, explicitConfigPath);
  const routing = prepareRuntimeRules({ rules, task, logger });

  return {
    rules,
    configPath,
    runtime: createRuntimeDependencies(repoRoot, rules, logger),
    routing
  };
}

export async function loadRules(
  repoRoot: string,
  explicitConfigPath?: string | null
): Promise<{ rules: RulesConfig; configPath: string | null }> {
  const rulesPath = new URL("../config/rules.json", import.meta.url);
  const raw = await fs.readFile(rulesPath, "utf8");
  const baseRules = JSON.parse(raw) as RulesConfig;
  const configPath = await resolveProjectConfigPath(repoRoot, explicitConfigPath);
  const projectRules = configPath ? await loadJsonIfExists<Partial<RulesConfig>>(configPath) : null;

  return {
    rules: mergeConfig(baseRules, projectRules),
    configPath
  };
}

export function prepareRuntimeRules({
  rules,
  task,
  logger
}: {
  rules: RulesConfig;
  task?: string;
  logger?: Logger;
}): RoutingDecision {
  applyGenericEnvOverrides(rules);
  const routing = resolveProviderRouting({ rules, task });
  const appliedRouting = applyDynamicProviderRouting(rules, routing, logger);
  applyExplicitEnvOverrides(rules);
  return appliedRouting;
}

export function resolveProviderRouting({
  rules,
  task
}: {
  rules: RulesConfig;
  task?: string;
}): RoutingDecision {
  const routing = rules.routing ?? {};
  const enabled = normalizeBooleanEnv(process.env.AI_SYSTEM_ROUTING_ENABLED, routing.enabled ?? true);
  const defaultProfile = normalizeRoutingProfileName(routing.default_profile) || "balanced";

  if (!enabled) {
    return {
      enabled: false,
      profile: defaultProfile,
      reason: "routing disabled",
      appliedRoles: {}
    };
  }

  const forcedProfile = normalizeRoutingProfileName(process.env.AI_SYSTEM_ROUTING_PROFILE) || mapRiskToRoutingProfile(process.env.AI_SYSTEM_RISK_PROFILE);
  if (forcedProfile) {
    return {
      enabled: true,
      profile: forcedProfile,
      reason: `forced by environment (${process.env.AI_SYSTEM_ROUTING_PROFILE ? "AI_SYSTEM_ROUTING_PROFILE" : "AI_SYSTEM_RISK_PROFILE"})`,
      appliedRoles: {}
    };
  }

  if (!task || !task.trim()) {
    return {
      enabled: true,
      profile: defaultProfile,
      reason: "no task provided",
      appliedRoles: {}
    };
  }

  const normalizedTask = task.toLowerCase();
  const safeKeywords = collectRoutingKeywords(routing, "safe", DEFAULT_SAFE_KEYWORDS);
  const fastKeywords = collectRoutingKeywords(routing, "fast", DEFAULT_FAST_KEYWORDS);

  const matchedSafeKeyword = safeKeywords.find((keyword) => normalizedTask.includes(keyword));
  if (matchedSafeKeyword) {
    return {
      enabled: true,
      profile: "safe",
      reason: `matched safe keyword "${matchedSafeKeyword}"`,
      appliedRoles: {}
    };
  }

  const matchedFastKeyword = fastKeywords.find((keyword) => normalizedTask.includes(keyword));
  if (matchedFastKeyword) {
    return {
      enabled: true,
      profile: "fast",
      reason: `matched fast keyword "${matchedFastKeyword}"`,
      appliedRoles: {}
    };
  }

  return {
    enabled: true,
    profile: defaultProfile,
    reason: "default profile",
    appliedRoles: {}
  };
}

export function applyDynamicProviderRouting(rules: RulesConfig, decision: RoutingDecision, logger?: Logger): RoutingDecision {
  if (!decision.enabled) {
    logger?.info(`Dynamic provider routing skipped: ${decision.reason}.`);
    return decision;
  }

  const profile = getRoutingProfile(rules, decision.profile);
  const appliedRoles: Partial<Record<ProviderRole, string>> = {};

  for (const role of PROVIDER_ROLES) {
    if (hasExplicitRoleProviderOverride(role)) {
      continue;
    }

    const targetProviderType = normalizeProviderType(profile[role]);
    if (!targetProviderType) {
      continue;
    }

    const template = resolveProviderTemplate(rules, role, targetProviderType);
    if (!template) {
      logger?.warn(`Dynamic routing skipped for ${role}: no provider template found for ${targetProviderType}.`);
      continue;
    }

    rules.providers[role] = buildRoutedProviderConfig(rules.providers[role], template, targetProviderType);
    appliedRoles[role] = targetProviderType;
  }

  const nextDecision: RoutingDecision = {
    ...decision,
    appliedRoles
  };
  const appliedSummary = PROVIDER_ROLES.filter((role) => appliedRoles[role]).map((role) => `${role}=${appliedRoles[role]}`).join(", ");
  logger?.info(`Dynamic provider routing selected profile "${decision.profile}" (${decision.reason})${appliedSummary ? ` -> ${appliedSummary}` : ""}.`);
  return nextDecision;
}

function applyGenericEnvOverrides(rules: RulesConfig): void {
  applySimpleProviderEnv(rules, process.env.AI_SYSTEM_PROVIDER);
  applySimpleMemoryEnv(rules, process.env.AI_SYSTEM_MEMORY);

  if (process.env.AI_SYSTEM_MAX_ITERATIONS) {
    rules.max_iterations = Number(process.env.AI_SYSTEM_MAX_ITERATIONS);
  }
  if (process.env.AI_SYSTEM_MAX_FILES) {
    rules.max_files = Number(process.env.AI_SYSTEM_MAX_FILES);
  }
  if (process.env.AI_SYSTEM_TOKEN_LIMIT_HINT) {
    rules.token_limit_hint = Number(process.env.AI_SYSTEM_TOKEN_LIMIT_HINT);
  }
  if (process.env.AI_SYSTEM_MEMORY_ENABLED) {
    rules.memory.enabled = process.env.AI_SYSTEM_MEMORY_ENABLED !== "false";
  }
  if (process.env.AI_SYSTEM_MEMORY_BACKEND) {
    rules.memory.backend = process.env.AI_SYSTEM_MEMORY_BACKEND;
  }
  if (process.env.AI_SYSTEM_MEMORY_TRANSPORT) {
    rules.memory.transport = process.env.AI_SYSTEM_MEMORY_TRANSPORT;
  }
  if (process.env.AI_SYSTEM_OPENMEMORY_BASE_URL) {
    rules.memory.base_url = process.env.AI_SYSTEM_OPENMEMORY_BASE_URL;
  }
  if (process.env.AI_SYSTEM_OPENMEMORY_API_KEY) {
    rules.memory.api_key = process.env.AI_SYSTEM_OPENMEMORY_API_KEY;
  }
}

function applyExplicitEnvOverrides(rules: RulesConfig): void {
  applyExplicitProviderTypeOverride(rules, "planner", process.env.AI_SYSTEM_PLANNER_PROVIDER);
  applyExplicitProviderTypeOverride(rules, "reviewer", process.env.AI_SYSTEM_REVIEWER_PROVIDER);
  applyExplicitProviderTypeOverride(rules, "generator", process.env.AI_SYSTEM_GENERATOR_PROVIDER);
  applyExplicitProviderTypeOverride(rules, "fixer", process.env.AI_SYSTEM_FIXER_PROVIDER);

  applyProviderOverride(rules.providers.planner, process.env.AI_SYSTEM_PLANNER_TIMEOUT_MS, process.env.AI_SYSTEM_PLANNER_RETRIES);
  applyProviderOverride(rules.providers.reviewer, process.env.AI_SYSTEM_REVIEWER_TIMEOUT_MS, process.env.AI_SYSTEM_REVIEWER_RETRIES);
  applyProviderOverride(rules.providers.generator, process.env.AI_SYSTEM_GENERATOR_TIMEOUT_MS, process.env.AI_SYSTEM_GENERATOR_RETRIES);
  applyProviderOverride(rules.providers.fixer, process.env.AI_SYSTEM_FIXER_TIMEOUT_MS, process.env.AI_SYSTEM_FIXER_RETRIES);

  applyMonitorOverride(rules.providers.planner, process.env.AI_SYSTEM_PLANNER_MONITOR_INTERVAL_MS);
  applyMonitorOverride(rules.providers.reviewer, process.env.AI_SYSTEM_REVIEWER_MONITOR_INTERVAL_MS);
  applyMonitorOverride(rules.providers.generator, process.env.AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS);
  applyMonitorOverride(rules.providers.fixer, process.env.AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS);

  applyOpenAICompatibleOverride(
    [rules.providers.planner, rules.providers.reviewer, rules.providers.generator, rules.providers.fixer],
    {
      baseUrl:
        process.env.AI_SYSTEM_BASE_URL ||
        process.env.AI_SYSTEM_OPENAI_BASE_URL ||
        process.env.AI_SYSTEM_9ROUTER_BASE_URL,
      apiKey:
        process.env.AI_SYSTEM_API_KEY ||
        process.env.AI_SYSTEM_OPENAI_API_KEY ||
        process.env.AI_SYSTEM_9ROUTER_API_KEY,
      model:
        process.env.AI_SYSTEM_MODEL ||
        process.env.AI_SYSTEM_OPENAI_MODEL ||
        process.env.AI_SYSTEM_9ROUTER_MODEL
    }
  );
}

function applySimpleProviderEnv(rules: RulesConfig, provider?: string): void {
  const normalized = normalizeProviderType(provider);
  if (!normalized) {
    return;
  }

  switch (normalized) {
    case "default":
    case "local":
    case "local-cli":
      rules.providers.planner.type = "gemini-cli";
      rules.providers.reviewer.type = "gemini-cli";
      rules.providers.generator.type = "codex-cli";
      rules.providers.fixer.type = "codex-cli";
      return;
    case "9router":
      rules.providers.planner.type = "openai-compatible";
      rules.providers.reviewer.type = "openai-compatible";
      rules.providers.generator.type = "openai-compatible";
      rules.providers.fixer.type = "openai-compatible";
      if (!process.env.AI_SYSTEM_BASE_URL && !process.env.AI_SYSTEM_OPENAI_BASE_URL && !process.env.AI_SYSTEM_9ROUTER_BASE_URL) {
        process.env.AI_SYSTEM_BASE_URL = "http://127.0.0.1:20128/v1";
      }
      return;
    case "openai-compatible":
    case "gemini-cli":
    case "claude-cli":
    case "codex-cli":
      rules.providers.planner.type = normalized;
      rules.providers.reviewer.type = normalized;
      rules.providers.generator.type = normalized;
      rules.providers.fixer.type = normalized;
      return;
    default:
      return;
  }
}

function applySimpleMemoryEnv(rules: RulesConfig, memoryValue?: string): void {
  const normalized = String(memoryValue || "").trim().toLowerCase();
  if (!normalized) {
    return;
  }

  switch (normalized) {
    case "off":
    case "false":
    case "disabled":
      rules.memory.enabled = false;
      return;
    case "local":
    case "local-file":
      rules.memory.enabled = true;
      rules.memory.backend = "local-file";
      return;
    case "openmemory":
      rules.memory.enabled = true;
      rules.memory.backend = "openmemory";
      return;
    default:
      return;
  }
}

function applyExplicitProviderTypeOverride(rules: RulesConfig, role: ProviderRole, providerType?: string): void {
  const normalized = normalizeProviderType(providerType);
  if (!normalized) {
    return;
  }

  const template = resolveProviderTemplate(rules, role, normalized);
  if (template) {
    rules.providers[role] = buildRoutedProviderConfig(rules.providers[role], template, normalized);
    return;
  }

  rules.providers[role].type = normalized;
}

function applyProviderOverride(providerConfig: ProviderConfig | undefined, timeoutMs?: string, retries?: string): void {
  if (!providerConfig) {
    return;
  }

  if (typeof timeoutMs !== "undefined") {
    providerConfig.timeout_ms = Number(timeoutMs);
  }

  if (typeof retries !== "undefined") {
    providerConfig.retries = Number(retries);
  }
}

function applyMonitorOverride(providerConfig: ProviderConfig | undefined, monitorIntervalMs?: string): void {
  if (!providerConfig) {
    return;
  }

  if (typeof monitorIntervalMs !== "undefined") {
    providerConfig.monitor_interval_ms = Number(monitorIntervalMs);
  }
}

function applyOpenAICompatibleOverride(
  providerConfigs: Array<ProviderConfig | undefined>,
  { baseUrl, apiKey, model }: { baseUrl?: string; apiKey?: string; model?: string }
): void {
  for (const providerConfig of providerConfigs) {
    if (!providerConfig || providerConfig.type !== "openai-compatible") {
      continue;
    }

    if (typeof baseUrl !== "undefined" && baseUrl !== "") {
      providerConfig.base_url = baseUrl;
    }
    if (typeof apiKey !== "undefined" && apiKey !== "") {
      providerConfig.api_key = apiKey;
    }
    if (typeof model !== "undefined" && model !== "") {
      providerConfig.model = model;
    }
  }
}

function getRoutingProfile(rules: RulesConfig, profileName: string): ProviderRoutingProfile {
  const normalizedProfile = normalizeRoutingProfileName(profileName) || "balanced";
  return {
    ...(DEFAULT_ROUTING_PROFILES[normalizedProfile] ?? {}),
    ...(rules.routing?.profiles?.[normalizedProfile] ?? {})
  };
}

function collectRoutingKeywords(routing: RoutingConfig, profileName: "fast" | "safe", fallback: string[]): string[] {
  const configured = routing.heuristics?.[profileName];
  if (!Array.isArray(configured)) {
    return fallback;
  }

  const normalized = configured
    .map((keyword) => String(keyword).trim().toLowerCase())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

function resolveProviderTemplate(rules: RulesConfig, role: ProviderRole, providerType: string): ProviderConfig | null {
  const directRoleMatch = rules.providers[role];
  if (directRoleMatch?.type === providerType) {
    return directRoleMatch;
  }

  for (const [name, provider] of Object.entries(rules.providers)) {
    if (name === role || !provider || typeof provider.type !== "string") {
      continue;
    }

    if (provider.type === providerType) {
      return provider;
    }
  }

  return null;
}

function buildRoutedProviderConfig(original: ProviderConfig, template: ProviderConfig, providerType: string): ProviderConfig {
  const routed: ProviderConfig = {
    ...template,
    type: providerType
  };
  const routedRecord = routed as Record<string, unknown>;
  const originalRecord = original as Record<string, unknown>;

  for (const key of ROUTING_CONTROL_KEYS) {
    if (typeof originalRecord[key] !== "undefined") {
      routedRecord[key] = originalRecord[key];
    }
  }

  return routed;
}

function hasExplicitRoleProviderOverride(role: ProviderRole): boolean {
  const envKey =
    role === "planner"
      ? "AI_SYSTEM_PLANNER_PROVIDER"
      : role === "reviewer"
        ? "AI_SYSTEM_REVIEWER_PROVIDER"
        : role === "generator"
          ? "AI_SYSTEM_GENERATOR_PROVIDER"
          : "AI_SYSTEM_FIXER_PROVIDER";

  return typeof process.env[envKey] === "string" && process.env[envKey]!.trim() !== "";
}

function normalizeProviderType(value?: string): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeRoutingProfileName(value?: string): string {
  return String(value || "").trim().toLowerCase();
}

function mapRiskToRoutingProfile(value?: string): string {
  const normalized = normalizeRoutingProfileName(value);
  switch (normalized) {
    case "low":
      return "fast";
    case "medium":
      return "balanced";
    case "high":
      return "safe";
    default:
      return normalized;
  }
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
