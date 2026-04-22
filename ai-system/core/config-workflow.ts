import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { loadEnvironment } from "../utils/api.js";
import {
  listProjectConfigPresets,
  loadJsonIfExists,
  resolveProjectConfigPath,
  writeJsonFile,
  type ProjectConfig,
  type ProjectConfigPresetName
} from "../utils/config.js";
import { loadRules, prepareRuntimeRules } from "./orchestrator-runtime.js";
import { summarizeConfiguredTools } from "./tool-executor.js";
import type { Logger, RoutingDecision, RulesConfig, ToolConfigurationSummary } from "../types.js";

export interface ConfigInspection {
  repoRoot: string;
  globalConfigPath: string | null;
  globalConfig: ProjectConfig | null;
  globalProfile: ProjectConfigPresetName | null;
  configPath: string | null;
  projectConfig: ProjectConfig | null;
  profile: ProjectConfigPresetName | null;
  effectiveRules: RulesConfig;
  routing: RoutingDecision;
  toolSummaries: ToolConfigurationSummary[];
  activeEnvOverrides: Array<{ key: string; value: string; category: "behavior" | "secret" }>;
  recommendations: string[];
}

export interface SetupChoices {
  providers: {
    planner: string | "auto";
    reviewer: string | "auto";
    generator: string | "auto";
    fixer: string | "auto";
  };
  routingEnabled: boolean;
  memoryBackend: "local-file" | "openmemory";
  openMemoryBaseUrl?: string;
  openMemoryApiKey?: string;
  tools?: Partial<
    Record<
      "lint" | "typecheck" | "build" | "test",
      {
        mode: "auto" | "disabled" | "script";
        script?: string;
        appendChangedFiles?: boolean;
      }
    >
  >;
}

export interface SetupCheckResult {
  inspection: ConfigInspection;
  configPath: string | null;
  envPath: string;
  cliAvailability: Record<"codex" | "gemini" | "claude", boolean>;
  openmemory:
    | {
        enabled: false;
      }
    | {
        enabled: true;
        baseUrl: string | null;
        hasApiKey: boolean;
        health: ProbeResult;
        query: ProbeResult;
        add: ProbeResult;
      };
}

interface ProbeResult {
  ok: boolean;
  status: number | null;
  message: string;
}

const ENV_BEHAVIOR_KEYS = [
  "AI_SYSTEM_PROVIDER",
  "AI_SYSTEM_PLANNER_PROVIDER",
  "AI_SYSTEM_REVIEWER_PROVIDER",
  "AI_SYSTEM_GENERATOR_PROVIDER",
  "AI_SYSTEM_FIXER_PROVIDER",
  "AI_SYSTEM_ROUTING_ENABLED",
  "AI_SYSTEM_ROUTING_PROFILE",
  "AI_SYSTEM_RISK_PROFILE",
  "AI_SYSTEM_MEMORY",
  "AI_SYSTEM_MEMORY_ENABLED",
  "AI_SYSTEM_MEMORY_BACKEND",
  "AI_SYSTEM_MEMORY_TRANSPORT"
] as const;

const ENV_SECRET_KEYS = [
  "AI_SYSTEM_OPENMEMORY_API_KEY",
  "AI_SYSTEM_API_KEY",
  "AI_SYSTEM_OPENAI_API_KEY",
  "AI_SYSTEM_9ROUTER_API_KEY"
] as const;

export async function inspectProjectConfiguration({
  repoRoot,
  explicitConfigPath,
  explicitGlobalConfigPath,
  ignoreProjectConfig = false,
  task
}: {
  repoRoot: string;
  explicitConfigPath?: string | null;
  explicitGlobalConfigPath?: string | null;
  ignoreProjectConfig?: boolean;
  task?: string;
}): Promise<ConfigInspection> {
  await loadEnvironment(repoRoot);
  const { rules, configPath, projectConfig, profile, globalConfigPath, globalConfig, globalProfile } = await loadRules(
    repoRoot,
    explicitConfigPath,
    explicitGlobalConfigPath,
    ignoreProjectConfig
  );
  const effectiveRules = JSON.parse(JSON.stringify(rules)) as RulesConfig;
  const routing = await prepareRuntimeRules({
    repoRoot,
    rules: effectiveRules,
    task,
    stage: "planning",
    logger: silentLogger()
  });
  const toolSummaries = await summarizeConfiguredTools({ repoRoot, rules: effectiveRules });

  const activeEnvOverrides = collectActiveEnvOverrides();
  const recommendations = buildRecommendations({
    configPath,
    projectConfig,
    profile,
    effectiveRules,
    activeEnvOverrides
  });

  return {
    repoRoot,
    globalConfigPath,
    globalConfig,
    globalProfile,
    configPath,
    projectConfig,
    profile,
    effectiveRules,
    routing,
    toolSummaries,
    activeEnvOverrides,
    recommendations
  };
}

export async function writeProjectPreset({
  repoRoot,
  explicitConfigPath,
  explicitGlobalConfigPath,
  preset
}: {
  repoRoot: string;
  explicitConfigPath?: string | null;
  explicitGlobalConfigPath?: string | null;
  preset: ProjectConfigPresetName;
}): Promise<{ configPath: string; config: ProjectConfig }> {
  const resolvedConfigPath =
    explicitGlobalConfigPath ??
    ((await resolveProjectConfigPath(repoRoot, explicitConfigPath)) ?? path.join(repoRoot, ".ai-system.json"));
  const currentConfig = (await loadJsonIfExists<ProjectConfig>(resolvedConfigPath)) ?? {};
  const nextConfig: ProjectConfig = {
    ...currentConfig,
    profile: preset
  };

  delete nextConfig.providers;
  delete nextConfig.routing;

  await writeJsonFile(resolvedConfigPath, nextConfig);

  return {
    configPath: resolvedConfigPath,
    config: nextConfig
  };
}

export async function applySetupChoices({
  repoRoot,
  explicitConfigPath,
  explicitGlobalConfigPath,
  choices
}: {
  repoRoot: string;
  explicitConfigPath?: string | null;
  explicitGlobalConfigPath?: string | null;
  choices: SetupChoices;
}): Promise<{ configPath: string; envPath: string; config: ProjectConfig }> {
  const resolvedConfigPath =
    explicitGlobalConfigPath ??
    ((await resolveProjectConfigPath(repoRoot, explicitConfigPath)) ?? path.join(repoRoot, ".ai-system.json"));
  const currentConfig = (await loadJsonIfExists<ProjectConfig>(resolvedConfigPath)) ?? {};
  const explicitProviders = Object.fromEntries(
    Object.entries(choices.providers)
      .filter(([, providerType]) => providerType !== "auto")
      .map(([role, providerType]) => [role, { type: providerType }])
  );
  const nextConfig: ProjectConfig = {
    ...currentConfig,
    routing: {
      ...(typeof currentConfig.routing === "object" && currentConfig.routing ? currentConfig.routing : {}),
      enabled: choices.routingEnabled
    },
    memory: {
      ...(currentConfig.memory ?? {}),
      enabled: true,
      backend: choices.memoryBackend
    },
    tools: {
      ...(typeof currentConfig.tools === "object" && currentConfig.tools ? currentConfig.tools : {}),
      enabled: true,
      json_validation: true,
      commands: buildToolCommandsConfig(choices.tools ?? {}, currentConfig.tools?.commands as Record<string, unknown> | undefined)
    }
  };

  delete nextConfig.profile;
  if (Object.keys(explicitProviders).length > 0) {
    nextConfig.providers = explicitProviders as ProjectConfig["providers"];
  } else {
    delete nextConfig.providers;
  }

  await writeJsonFile(resolvedConfigPath, nextConfig);

  const envPath = path.join(repoRoot, ".env");
  await upsertEnvFile(envPath, {
    AI_SYSTEM_OPENMEMORY_BASE_URL:
      choices.memoryBackend === "openmemory" ? choices.openMemoryBaseUrl?.trim() || "http://127.0.0.1:9080" : null,
    AI_SYSTEM_OPENMEMORY_API_KEY:
      choices.memoryBackend === "openmemory"
        ? typeof choices.openMemoryApiKey === "string" && choices.openMemoryApiKey.trim() !== ""
          ? choices.openMemoryApiKey.trim()
          : undefined
        : null
  });

  return {
    configPath: resolvedConfigPath,
    envPath,
    config: nextConfig
  };
}

function buildToolCommandsConfig(
  tools: NonNullable<SetupChoices["tools"]>,
  currentCommands: Record<string, unknown> | undefined
): NonNullable<NonNullable<ProjectConfig["tools"]>["commands"]> {
  const output = { ...(currentCommands ?? {}) } as NonNullable<NonNullable<ProjectConfig["tools"]>["commands"]>;

  for (const toolName of ["lint", "typecheck", "build", "test"] as const) {
    const selection = tools[toolName];
    if (!selection) {
      continue;
    }

    if (selection.mode === "auto") {
      const current = output[toolName];
      if (current && typeof current === "object" && !Array.isArray(current)) {
        const { script: _script, command: _command, args: _args, append_changed_files: _append, ...rest } = current as Record<string, unknown>;
        output[toolName] = {
          ...rest,
          enabled: true
        } as NonNullable<NonNullable<ProjectConfig["tools"]>["commands"]>[string];
      } else {
        output[toolName] = { enabled: true } as NonNullable<NonNullable<ProjectConfig["tools"]>["commands"]>[string];
      }
      continue;
    }

    if (selection.mode === "disabled") {
      output[toolName] = { enabled: false } as NonNullable<NonNullable<ProjectConfig["tools"]>["commands"]>[string];
      continue;
    }

    output[toolName] = {
      enabled: true,
      script: selection.script?.trim() || toolName,
      ...(selection.appendChangedFiles ? { append_changed_files: true } : {})
    } as NonNullable<NonNullable<ProjectConfig["tools"]>["commands"]>[string];
  }

  return output;
}

export async function runSetupCheck({
  repoRoot,
  explicitConfigPath,
  explicitGlobalConfigPath,
  ignoreProjectConfig = false
}: {
  repoRoot: string;
  explicitConfigPath?: string | null;
  explicitGlobalConfigPath?: string | null;
  ignoreProjectConfig?: boolean;
}): Promise<SetupCheckResult> {
  const inspection = await inspectProjectConfiguration({ repoRoot, explicitConfigPath, explicitGlobalConfigPath, ignoreProjectConfig });
  const envPath = path.join(repoRoot, ".env");
  const cliAvailability = {
    codex: await commandExists("codex"),
    gemini: await commandExists("gemini"),
    claude: await commandExists("claude")
  };

  const openmemory =
    inspection.effectiveRules.memory?.enabled !== false && inspection.effectiveRules.memory?.backend === "openmemory"
      ? {
          enabled: true as const,
          baseUrl: String(inspection.effectiveRules.memory?.base_url || "").trim() || null,
          hasApiKey: Boolean(inspection.effectiveRules.memory?.api_key),
          health: await probeOpenMemory(inspection.effectiveRules.memory, "health"),
          query: await probeOpenMemory(inspection.effectiveRules.memory, "query"),
          add: await probeOpenMemory(inspection.effectiveRules.memory, "add")
        }
      : {
          enabled: false as const
        };

  return {
    inspection,
    configPath: inspection.configPath,
    envPath,
    cliAvailability,
    openmemory
  };
}

export function getPresetCatalog(): Array<{ name: ProjectConfigPresetName; summary: string }> {
  return listProjectConfigPresets();
}

export async function readEnvValues(repoRoot: string): Promise<Record<string, string>> {
  const envPath = path.join(repoRoot, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    return parseEnvContent(raw);
  } catch (error) {
    const normalized = error as NodeJS.ErrnoException | undefined;
    if (normalized?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function collectActiveEnvOverrides(): Array<{ key: string; value: string; category: "behavior" | "secret" }> {
  const result: Array<{ key: string; value: string; category: "behavior" | "secret" }> = [];

  for (const key of ENV_BEHAVIOR_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") {
      result.push({ key, value, category: "behavior" });
    }
  }

  for (const key of ENV_SECRET_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") {
      result.push({ key, value: redactSecret(value), category: "secret" });
    }
  }

  return result;
}

function buildRecommendations({
  configPath,
  projectConfig,
  profile,
  effectiveRules,
  activeEnvOverrides
}: {
  configPath: string | null;
  projectConfig: ProjectConfig | null;
  profile: ProjectConfigPresetName | null;
  effectiveRules: RulesConfig;
  activeEnvOverrides: Array<{ key: string; value: string; category: "behavior" | "secret" }>;
}): string[] {
  const recommendations: string[] = [];

  if (!configPath) {
    recommendations.push("No project config file is present. Use `ai config use codex-all` or create `.ai-system.json` to make behavior explicit.");
  }

  if (!profile && !projectConfig?.providers) {
    recommendations.push("No preset is selected. Use `ai config use codex-all|hybrid|safe-review` so project behavior is easier to reason about.");
  }

  if (activeEnvOverrides.some((entry) => entry.category === "behavior")) {
    recommendations.push("Behavior-changing env overrides are active. Move long-lived provider/routing choices into `.ai-system.json` and keep `.env` for secrets only.");
  }

  if (projectConfig?.providers && profile) {
    recommendations.push("This project config uses both `profile` and explicit `providers`. Explicit providers win over the preset for those roles.");
  }

  if (projectConfig?.providers && !profile) {
    recommendations.push("This project config uses explicit per-role providers. `ai setup` can update those role assignments directly.");
  }

  if (effectiveRules.routing?.enabled !== false) {
    recommendations.push("Dynamic routing is enabled. Effective providers may change per task even if `.ai-system.json` sets role defaults.");
  }

  if (effectiveRules.memory?.backend === "openmemory" && !effectiveRules.memory?.base_url) {
    recommendations.push("OpenMemory is enabled without `base_url`. Set `AI_SYSTEM_OPENMEMORY_BASE_URL` in `.env`.");
  }

  if (effectiveRules.memory?.backend === "openmemory" && !effectiveRules.memory?.api_key) {
    recommendations.push("OpenMemory is enabled without an API key. Set `AI_SYSTEM_OPENMEMORY_API_KEY` in `.env`.");
  }

  return recommendations;
}

async function upsertEnvFile(envPath: string, changes: Record<string, string | null | undefined>): Promise<void> {
  let raw = "";
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch (error) {
    const normalized = error as NodeJS.ErrnoException | undefined;
    if (normalized?.code !== "ENOENT") {
      throw error;
    }
  }

  const lines = raw ? raw.split(/\r?\n/) : [];
  const keys = Object.keys(changes);
  const seen = new Set<string>();
  const nextLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match) {
      nextLines.push(line);
      continue;
    }

    const key = match[1];
    if (!keys.includes(key)) {
      nextLines.push(line);
      continue;
    }

    seen.add(key);
    const nextValue = changes[key];
    if (nextValue === null) {
      continue;
    }
    if (typeof nextValue === "undefined") {
      nextLines.push(line);
      continue;
    }

    nextLines.push(`${key}=${quoteEnvValue(nextValue)}`);
  }

  for (const key of keys) {
    if (seen.has(key)) {
      continue;
    }
    const nextValue = changes[key];
    if (nextValue === null || typeof nextValue === "undefined") {
      continue;
    }
    nextLines.push(`${key}=${quoteEnvValue(nextValue)}`);
  }

  const serialized = nextLines.join("\n").replace(/\n*$/, "\n");
  await fs.writeFile(envPath, serialized, "utf8");
}

function parseEnvContent(raw: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim().replace(/^export\s+/, "");
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function quoteEnvValue(value: string): string {
  return /[\s#'"]/.test(value) ? JSON.stringify(value) : value;
}

async function commandExists(command: string): Promise<boolean> {
  const pathValue = process.env.PATH || "";
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  const candidates =
    process.platform === "win32"
      ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
      : [command];

  for (const entry of entries) {
    for (const candidate of candidates) {
      const target = path.join(entry, candidate);
      try {
        const stats = await fs.stat(target);
        if (stats.isFile()) {
          if (process.platform === "win32") {
            return true;
          }
          await fs.access(target, fs.constants.X_OK);
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}

async function probeOpenMemory(memory: RulesConfig["memory"], kind: "health" | "query" | "add"): Promise<ProbeResult> {
  const baseUrl = String(memory?.base_url || "").trim();
  if (!baseUrl) {
    return { ok: false, status: null, message: "Missing base URL" };
  }

  try {
    if (kind === "health") {
      const response = await requestUrl({
        url: `${stripTrailingSlash(baseUrl)}/health`,
        method: "GET",
        headers: buildOpenMemoryHeaders(memory),
        timeoutMs: memory?.health_timeout_ms ?? 10000
      });
      return { ok: response.ok, status: response.status, message: truncateText(response.body) || response.statusText };
    }

    const body =
      kind === "query"
        ? JSON.stringify({
            query: "setup-check",
            k: 1,
            user_id: "ai-system-setup-check",
            filters: { user_id: "ai-system-setup-check" }
          })
        : JSON.stringify({
            content: "ai-system setup check",
            tags: ["ai-system", "setup-check"],
            metadata: { source: "ai-system-setup-check" },
            user_id: "ai-system-setup-check"
          });
    const response = await requestUrl({
      url: `${stripTrailingSlash(baseUrl)}/${kind === "query" ? "memory/query" : "memory/add"}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildOpenMemoryHeaders(memory)
      },
      body,
      timeoutMs: kind === "query" ? memory?.query_timeout_ms ?? 15000 : memory?.store_timeout_ms ?? 15000
    });
    return { ok: response.ok, status: response.status, message: truncateText(response.body) || response.statusText };
  } catch (error) {
    const normalized = error as Error;
    return { ok: false, status: null, message: normalized.message };
  }
}

function buildOpenMemoryHeaders(memory: RulesConfig["memory"]): Record<string, string> {
  return memory?.api_key ? { Accept: "application/json", "x-api-key": String(memory.api_key) } : { Accept: "application/json" };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truncateText(value: string, maxLength = 220): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function redactSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "***";
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

async function requestUrl({
  url,
  method,
  headers,
  body,
  timeoutMs
}: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  return await new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          ...headers,
          ...(typeof body === "string" ? { "Content-Length": Buffer.byteLength(body, "utf8").toString() } : {})
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
            status: response.statusCode ?? 500,
            statusText: response.statusMessage ?? "",
            body: responseBody
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    if (typeof body === "string") {
      request.write(body);
    }
    request.end();
  });
}

function silentLogger(): Logger {
  return {
    step() {},
    info() {},
    warn() {},
    error() {},
    success() {}
  };
}
