import fs from "node:fs/promises";
import path from "node:path";
import type { RulesConfig } from "../types.js";
import { resolveProjectConfigPath } from "../utils/config.js";
import { resolveJobQueueDirectory } from "./job-queue.js";

export interface ProjectRegistryEntry {
  id: string;
  name: string;
  cwd: string;
  configPath: string | null;
  queueDir: string;
  artifactsDir: string;
  exists: boolean;
}

export async function buildProjectRegistry(
  workdirs: string[],
  loadRulesForProject: (cwd: string) => Promise<{ rules: RulesConfig }>
): Promise<ProjectRegistryEntry[]> {
  const entries = await Promise.all(
    unique(workdirs).map(async (cwd) => {
      const resolved = path.resolve(cwd);
      const exists = await pathExists(resolved);
      let artifactDataDir = ".ai-system-artifacts";
      try {
        artifactDataDir = (await loadRulesForProject(resolved)).rules.artifacts?.data_dir ?? artifactDataDir;
      } catch {
        artifactDataDir = ".ai-system-artifacts";
      }

      return {
        id: slugProjectId(resolved),
        name: path.basename(resolved) || resolved,
        cwd: resolved,
        configPath: await resolveProjectConfigPath(resolved),
        queueDir: resolveJobQueueDirectory(resolved),
        artifactsDir: path.join(resolved, artifactDataDir),
        exists
      };
    })
  );
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function slugProjectId(cwd: string): string {
  return cwd.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
