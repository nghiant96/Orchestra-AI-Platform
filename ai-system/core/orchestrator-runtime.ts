import fs from "node:fs/promises";
import path from "node:path";
import {
  getProjectConfigPreset,
  loadJsonIfExists,
  mergeConfig,
  resolveGlobalConfigPath,
  resolveProjectConfigPath,
  stripProjectConfigProfile,
  type ProjectConfig,
  type ProjectConfigPresetName
} from "../utils/config.js";
import type {
  Logger,
  ProviderConfig,
  ProviderRole,
  RoutingDecision,
  RulesConfig
} from "../types.js";
import { buildRoutingDecision } from "./provider-router.js";
import { createRuntimeDependencies, type RuntimeDependencies } from "./run-executor.js";

const PROVIDER_ROLES: ProviderRole[] = ["planner", "reviewer", "generator", "fixer"];
const ROUTING_CONTROL_KEYS = ["timeout_ms", "retries", "base_delay_ms", "monitor_interval_ms", "temperature", "response_format"] as const;
const DEFAULT_PROVIDER_COMMANDS: Record<string, string> = {
  "gemini-cli": "gemini",
  "claude-cli": "claude",
  "codex-cli": "codex"
};

export interface LoadedOrchestratorRuntime {
  rules: RulesConfig;
  configPath: string | null;
  runtime: RuntimeDependencies;
  routing: RoutingDecision;
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
  const routing = await prepareRuntimeRules({ repoRoot, rules, task, stage: "planning", logger });

  return {
    rules,
    configPath,
    runtime: createRuntimeDependencies(repoRoot, rules, logger),
    routing
  };
}

export async function rerouteRuntimeForPlan({
  repoRoot,
  rules,
  task,
  plan,
  logger
}: {
  repoRoot: string;
  rules: RulesConfig;
  task?: string;
  plan: import("../types.js").PlanResult;
  logger: Logger;
}): Promise<{ runtime: RuntimeDependencies; routing: RoutingDecision }> {
  const routing = await prepareRuntimeRules({
    repoRoot,
    rules,
    task,
    stage: "implementation",
    plan,
    logger
  });

  return {
    runtime: createRuntimeDependencies(repoRoot, rules, logger),
    routing
  };
}

import { applyPluginsToRules, discoverPlugins } from "./plugins.js";

export async function loadRules(
  repoRoot: string,
  explicitConfigPath?: string | null,
  explicitGlobalConfigPath?: string | null,
  ignoreProjectConfig = false,
  logger?: Logger
): Promise<{
  rules: RulesConfig;
  configPath: string | null;
  projectConfig: ProjectConfig | null;
  profile: ProjectConfigPresetName | null;
  globalConfigPath: string | null;
  globalConfig: ProjectConfig | null;
  globalProfile: ProjectConfigPresetName | null;
  plugins: import("../types.js").PluginInfo[];
}> {
  const rulesPath = new URL("../config/rules.json", import.meta.url);
  const raw = await fs.readFile(rulesPath, "utf8");
  const baseRules = JSON.parse(raw) as RulesConfig;
  const globalConfigPath = await resolveGlobalConfigPath(explicitGlobalConfigPath);
  const globalConfig = globalConfigPath ? await loadJsonIfExists<ProjectConfig>(globalConfigPath) : null;
  const globalPreset = getProjectConfigPreset(globalConfig?.profile);
  const globalRules = stripProjectConfigProfile(globalConfig);
  const configPath = ignoreProjectConfig ? null : await resolveProjectConfigPath(repoRoot, explicitConfigPath);
  const projectConfig = configPath ? await loadJsonIfExists<ProjectConfig>(configPath) : null;
  const preset = getProjectConfigPreset(projectConfig?.profile);
  const projectRules = stripProjectConfigProfile(projectConfig);
  
  let mergedRules = mergeConfig(
    mergeConfig(mergeConfig(mergeConfig(baseRules, globalPreset?.config ?? null), globalRules), preset?.config ?? null),
    projectRules
  );

  // Discovery & Apply Plugins
  const plugins = await discoverPlugins(repoRoot, logger);
  mergedRules = applyPluginsToRules(mergedRules, plugins);

  mergedRules.routing = {
    ...(mergedRules.routing ?? {}),
    locked_roles: Object.keys(projectConfig?.providers ?? {})
  };
  mergedRules.prompts = {
    ...(mergedRules.prompts ?? {}),
    allowed_roots: buildPromptAllowedRoots(repoRoot, configPath, globalConfigPath),
    base_dir: resolvePromptBaseDir(repoRoot, projectRules, configPath, globalRules, globalConfigPath)
  };
  normalizeAllProviderConfigs(mergedRules);

  return {
    rules: mergedRules,
    configPath,
    projectConfig,
    profile: preset?.name ?? null,
    globalConfigPath,
    globalConfig,
    globalProfile: globalPreset?.name ?? null,
    plugins
  };
}

function buildPromptAllowedRoots(repoRoot: string, configPath: string | null, globalConfigPath: string | null): string[] {
  return [...new Set([repoRoot, configPath ? path.dirname(configPath) : null, globalConfigPath ? path.dirname(globalConfigPath) : null]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => path.resolve(entry)))];
}

function resolvePromptBaseDir(
  repoRoot: string,
  projectRules: Omit<ProjectConfig, "profile"> | null,
  configPath: string | null,
  globalRules: Omit<ProjectConfig, "profile"> | null,
  globalConfigPath: string | null
): string {
  if (projectRules?.prompts && configPath) {
    return path.dirname(configPath);
  }
  if (globalRules?.prompts && globalConfigPath) {
    return path.dirname(globalConfigPath);
  }
  return repoRoot;
}

export async function prepareRuntimeRules({
  repoRoot,
  rules,
  task,
  stage,
  plan,
  logger
}: {
  repoRoot: string;
  rules: RulesConfig;
  task?: string;
  stage: "planning" | "implementation";
  plan?: import("../types.js").PlanResult | null;
  logger?: Logger;
}): Promise<RoutingDecision> {
  applyGenericEnvOverrides(rules);
  const routing = await buildRoutingDecision({ repoRoot, rules, task, stage, plan });
  const appliedRouting = applyDynamicProviderRouting(rules, routing, logger);
  applyExplicitEnvOverrides(rules);
  return appliedRouting;
}

export function applyDynamicProviderRouting(rules: RulesConfig, decision: RoutingDecision, logger?: Logger): RoutingDecision {
  if (!decision.enabled) {
    logger?.info(`Dynamic provider routing skipped: ${decision.reason}.`);
    return decision;
  }

  const appliedRoles: Partial<Record<ProviderRole, string>> = {};

  for (const role of PROVIDER_ROLES) {
    if (isProjectLockedRole(rules, role)) {
      continue;
    }
    if (hasExplicitRoleProviderOverride(role)) {
      continue;
    }

    const targetProviderType = normalizeProviderType(decision.roleProviders[role]);
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
  logger?.info(
    `Dynamic provider routing selected ${decision.stage} profile "${decision.profile}" (${decision.reason})${appliedSummary ? ` -> ${appliedSummary}` : ""}.`
  );
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
      rules.providers.planner = buildProviderConfigForType(rules, "planner", "gemini-cli");
      rules.providers.reviewer = buildProviderConfigForType(rules, "reviewer", "gemini-cli");
      rules.providers.generator = buildProviderConfigForType(rules, "generator", "codex-cli");
      rules.providers.fixer = buildProviderConfigForType(rules, "fixer", "codex-cli");
      return;
    case "9router":
      applyProviderTypeToAllRoles(rules, "openai-compatible");
      if (!process.env.AI_SYSTEM_BASE_URL && !process.env.AI_SYSTEM_OPENAI_BASE_URL && !process.env.AI_SYSTEM_9ROUTER_BASE_URL) {
        process.env.AI_SYSTEM_BASE_URL = "http://127.0.0.1:20128/v1";
      }
      return;
    case "openai-compatible":
    case "gemini-cli":
    case "claude-cli":
    case "codex-cli":
      applyProviderTypeToAllRoles(rules, normalized);
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

  rules.providers[role] = buildProviderConfigForType(rules, role, normalized);
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

function resolveProviderTemplate(rules: RulesConfig, role: ProviderRole, providerType: string): ProviderConfig | null {
  const directRoleMatch = rules.providers[role];
  const candidates: ProviderConfig[] = [];

  for (const [name, provider] of Object.entries(rules.providers)) {
    if (name === role || !provider || typeof provider.type !== "string") {
      continue;
    }

    if (provider.type === providerType) {
      candidates.push(provider);
    }
  }

  if (directRoleMatch?.type === providerType) {
    candidates.push(directRoleMatch);
  }

  if (candidates.length === 0) {
    return null;
  }

  const expectedCommand = DEFAULT_PROVIDER_COMMANDS[providerType];
  if (expectedCommand) {
    const canonical = candidates.find((candidate) => candidate.command === expectedCommand);
    if (canonical) {
      return canonical;
    }
  }

  return candidates[0];
}

function normalizeAllProviderConfigs(rules: RulesConfig): void {
  const roles: ProviderRole[] = ["planner", "reviewer", "generator", "fixer"];
  for (const role of roles) {
    const providerType = normalizeProviderType(rules.providers[role]?.type);
    if (!providerType) {
      continue;
    }

    rules.providers[role] = buildProviderConfigForType(rules, role, providerType);
  }
}

function applyProviderTypeToAllRoles(rules: RulesConfig, providerType: string): void {
  const roles: ProviderRole[] = ["planner", "reviewer", "generator", "fixer"];
  for (const role of roles) {
    rules.providers[role] = buildProviderConfigForType(rules, role, providerType);
  }
}

function buildProviderConfigForType(rules: RulesConfig, role: ProviderRole, providerType: string): ProviderConfig {
  const original = rules.providers[role];
  const template = resolveProviderTemplate(rules, role, providerType);
  if (template) {
    return buildRoutedProviderConfig(original, template, providerType);
  }

  return {
    ...original,
    type: providerType
  };
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

function isProjectLockedRole(rules: RulesConfig, role: ProviderRole): boolean {
  return Array.isArray(rules.routing?.locked_roles) && rules.routing!.locked_roles!.includes(role);
}

function normalizeProviderType(value?: string): string {
  return String(value || "").trim().toLowerCase();
}
