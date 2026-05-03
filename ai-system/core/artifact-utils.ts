import fs from "node:fs/promises";

/**
 * Reads a JSON file if it exists, otherwise returns null.
 */
export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Checks if a path exists.
 */
export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a unique run directory name based on timestamp and random string.
 */
export function createRunDirectoryName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${random}`;
}

/**
 * Normalizes status string for consistent reporting.
 */
export function normalizeRunStatus(status: string): string {
  switch (status) {
    case "completed":
    case "resumed_completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "paused_after_plan":
    case "paused_after_generate":
      return "waiting_for_approval";
    default:
      return "failed";
  }
}
