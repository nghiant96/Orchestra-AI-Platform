import fs from "node:fs/promises";
import path from "node:path";
import type { RulesConfig } from "../types.js";
import { WorkStore } from "./work-store.js";
import type { WorkItem } from "./work-item.js";
import { removeWorktree } from "./worktree-manager.js";

export async function cleanupFinishedWorktree(repoRoot: string, workItem: WorkItem): Promise<boolean> {
  if (!workItem.worktreePath) return false;
  if (workItem.status !== "done" && workItem.status !== "cancelled" && workItem.status !== "failed") return false;
  try {
    await removeWorktree(repoRoot, workItem.worktreePath);
  } catch {
    // ignore worktree removal failures and still try to clear the directory
  }
  await fs.rm(path.dirname(workItem.worktreePath), { recursive: true, force: true });
  return true;
}

export async function pruneStaleWorktreeRoots(repoRoot: string, maxAgeDays: number): Promise<number> {
  const worktreeRoot = path.join(repoRoot, ".ai-system-worktrees");
  let removed = 0;
  try {
    const entries = await fs.readdir(worktreeRoot, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const dir = path.join(worktreeRoot, entry.name);
      try {
        const stat = await fs.stat(dir);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(dir, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // ignore
      }
    }));
  } catch {
    return 0;
  }
  return removed;
}

export interface WorkspaceCleanupReport {
  removedWorktrees: number;
  repairedWorkItems: number;
}

export async function cleanupWorkspaceLifecycle(repoRoot: string, rules: RulesConfig): Promise<WorkspaceCleanupReport> {
  const store = new WorkStore(repoRoot, rules);
  const workItems = await store.list();
  let repairedWorkItems = 0;
  for (const item of workItems) {
    if (item.worktreePath) {
      try {
        await fs.stat(item.worktreePath);
      } catch {
        await store.save({ ...item, worktreePath: undefined, updatedAt: new Date().toISOString() });
        repairedWorkItems += 1;
      }
    }
  }

  const removedWorktrees = await pruneStaleWorktreeRoots(repoRoot, rules.retention?.queue_days ?? 30);
  return { removedWorktrees, repairedWorkItems };
}
