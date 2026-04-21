import fs from "node:fs/promises";
import path from "node:path";

export async function loadJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw new Error(`Failed to load config ${filePath}: ${error.message}`);
  }
}

export async function resolveProjectConfigPath(repoRoot, explicitConfigPath) {
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

export function mergeConfig(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }

  const output = Array.isArray(base) ? [...base] : { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (value && typeof value === "object") {
      const current = output[key] && typeof output[key] === "object" && !Array.isArray(output[key]) ? output[key] : {};
      output[key] = mergeConfig(current, value);
      continue;
    }

    output[key] = value;
  }

  return output;
}
