import fs from "node:fs/promises";
import path from "node:path";
import type { CliCommandError } from "../types.js";

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
