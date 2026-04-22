import fs from "node:fs/promises";
import { loadJsonIfExists, mergeConfig, resolveProjectConfigPath } from "../utils/config.js";
import type { Logger, ProviderConfig, RulesConfig } from "../types.js";
import { createRuntimeDependencies, type RuntimeDependencies } from "./run-executor.js";

export interface LoadedOrchestratorRuntime {
  rules: RulesConfig;
  configPath: string | null;
  runtime: RuntimeDependencies;
}

export async function loadOrchestratorRuntime({
  repoRoot,
  explicitConfigPath,
  logger
}: {
  repoRoot: string;
  explicitConfigPath?: string | null;
  logger: Logger;
}): Promise<LoadedOrchestratorRuntime> {
  const { rules, configPath } = await loadRules(repoRoot, explicitConfigPath);
  applyEnvOverrides(rules);

  return {
    rules,
    configPath,
    runtime: createRuntimeDependencies(repoRoot, rules, logger)
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

export function applyEnvOverrides(rules: RulesConfig): void {
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
  if (process.env.AI_SYSTEM_PLANNER_PROVIDER) {
    rules.providers.planner.type = process.env.AI_SYSTEM_PLANNER_PROVIDER;
  }
  if (process.env.AI_SYSTEM_REVIEWER_PROVIDER) {
    rules.providers.reviewer.type = process.env.AI_SYSTEM_REVIEWER_PROVIDER;
  }
  if (process.env.AI_SYSTEM_GENERATOR_PROVIDER) {
    rules.providers.generator.type = process.env.AI_SYSTEM_GENERATOR_PROVIDER;
  }
  if (process.env.AI_SYSTEM_FIXER_PROVIDER) {
    rules.providers.fixer.type = process.env.AI_SYSTEM_FIXER_PROVIDER;
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
  const normalized = String(provider || "").trim().toLowerCase();
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
