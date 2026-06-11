import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/api.js";

export type MemoryScope = "project" | "workspace" | "global";

export interface MemoryNamespace {
  workspaceRootHash: string;
  projectId: string;
  repoRemote?: string;
  scope: MemoryScope;
}

export async function buildMemoryNamespace(repoRoot: string): Promise<MemoryNamespace> {
  const [realRoot, repoRemote] = await Promise.all([
    resolveRealPath(repoRoot),
    readGitValue(repoRoot, ["config", "--get", "remote.origin.url"])
  ]);

  return {
    workspaceRootHash: crypto.createHash("sha256").update(realRoot).digest("hex").slice(0, 16),
    projectId: path.basename(realRoot) || "project",
    repoRemote: repoRemote || undefined,
    scope: "project"
  };
}

async function resolveRealPath(repoRoot: string): Promise<string> {
  try {
    return await fs.realpath(repoRoot);
  } catch {
    return repoRoot;
  }
}

async function readGitValue(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await runCommand({ command: "git", args, cwd, timeoutMs: 10000 });
    return result.stdout.trim();
  } catch {
    return "";
  }
}
