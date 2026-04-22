import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CliCommandError } from "../types.js";
import type { RulesConfig } from "../types.js";

export type ProjectConfigPresetName = "codex-all" | "hybrid" | "safe-review";

export type ProjectConfig = Partial<RulesConfig> & {
  profile?: ProjectConfigPresetName | string;
};

const PROJECT_CONFIG_PRESETS: Record<ProjectConfigPresetName, Partial<RulesConfig>> = {
  "codex-all": {
    routing: {
      enabled: false
    },
    providers: {
      planner: { type: "codex-cli" },
      reviewer: { type: "codex-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    }
  },
  hybrid: {
    routing: {
      enabled: true
    },
    providers: {
      planner: { type: "gemini-cli" },
      reviewer: { type: "gemini-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    }
  },
  "safe-review": {
    routing: {
      enabled: false
    },
    providers: {
      planner: { type: "gemini-cli" },
      reviewer: { type: "claude-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    }
  }
};

export async function loadJsonIfExists<T = Record<string, unknown>>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const normalized = error as CliCommandError | undefined;
    if (normalized?.code === "ENOENT") {
      return null;
    }

    throw new Error(`Failed to load config ${filePath}: ${normalized?.message ?? "Unknown error"}`);
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function resolveProjectConfigPath(repoRoot: string, explicitConfigPath?: string | null): Promise<string | null> {
  if (explicitConfigPath) {
    return path.resolve(explicitConfigPath);
  }

  const candidate = path.join(repoRoot, ".ai-system.json");
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export function getDefaultGlobalConfigPath(): string {
  return path.join(os.homedir(), ".config", "ai-system", "config.json");
}

export async function resolveGlobalConfigPath(explicitGlobalConfigPath?: string | null): Promise<string | null> {
  const candidate = explicitGlobalConfigPath || process.env.AI_SYSTEM_GLOBAL_CONFIG || getDefaultGlobalConfigPath();
  if (!candidate) {
    return null;
  }

  const resolved = path.resolve(candidate);
  try {
    await fs.access(resolved);
    return resolved;
  } catch {
    return explicitGlobalConfigPath || process.env.AI_SYSTEM_GLOBAL_CONFIG ? resolved : null;
  }
}

export function normalizeProjectConfigPresetName(value?: string | null): ProjectConfigPresetName | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "codex-all" || normalized === "hybrid" || normalized === "safe-review") {
    return normalized;
  }

  return null;
}

export function getProjectConfigPreset(name?: string | null): { name: ProjectConfigPresetName; config: Partial<RulesConfig> } | null {
  const normalized = normalizeProjectConfigPresetName(name);
  if (!normalized) {
    return null;
  }

  return {
    name: normalized,
    config: PROJECT_CONFIG_PRESETS[normalized]
  };
}

export function listProjectConfigPresets(): Array<{ name: ProjectConfigPresetName; summary: string }> {
  return [
    { name: "codex-all", summary: "Use Codex for planner, reviewer, generator, and fixer. Disable dynamic routing." },
    { name: "hybrid", summary: "Use Gemini for planning/review and Codex for generation/fixes. Keep dynamic routing enabled." },
    { name: "safe-review", summary: "Use Gemini planning, Claude review, and Codex generation/fixes. Disable dynamic routing." }
  ];
}

export function stripProjectConfigProfile<T extends ProjectConfig | null | undefined>(config: T): Omit<NonNullable<T>, "profile"> | null {
  if (!config) {
    return null;
  }

  const { profile: _profile, ...rest } = config;
  return rest as Omit<NonNullable<T>, "profile">;
}

export function mergeConfig<T extends Record<string, unknown>>(base: T, override: Record<string, unknown> | null | undefined): T {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (value && typeof value === "object") {
      const current =
        output[key] && typeof output[key] === "object" && !Array.isArray(output[key])
          ? (output[key] as Record<string, unknown>)
          : {};
      output[key] = mergeConfig(current, value as Record<string, unknown>);
      continue;
    }

    output[key] = value;
  }

  return output as T;
}
