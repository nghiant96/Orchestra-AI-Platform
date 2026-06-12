import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/api.js";

export type DirtyTreeMode = "allow" | "stash" | "worktree";

export interface DirtyTreePreparation {
  executionRoot: string;
  cleanup: () => Promise<void>;
}

export async function prepareDirtyTreeExecution(input: {
  repoRoot: string;
  jobId: string;
  mode: DirtyTreeMode;
}): Promise<DirtyTreePreparation> {
  const repoRoot = await fs.realpath(input.repoRoot);
  if (input.mode === "allow") {
    return { executionRoot: repoRoot, cleanup: async () => {} };
  }

  if (input.mode === "stash") {
    const dirty = await isWorkingTreeDirty(repoRoot);
    let stashed = false;
    if (dirty) {
      await runCommand({
        command: "git",
        args: ["stash", "push", "--include-untracked", "--quiet", "--message", `orchestra-solo-${input.jobId}`],
        cwd: repoRoot,
        timeoutMs: 30000
      });
      stashed = true;
    }

    return {
      executionRoot: repoRoot,
      cleanup: async () => {
        if (!stashed) return;
        await runCommand({
          command: "git",
          args: ["stash", "pop", "--quiet"],
          cwd: repoRoot,
          timeoutMs: 30000
        });
      }
    };
  }

  const worktreePath = path.join(repoRoot, ".orchestra", "worktrees", sanitizeJobId(input.jobId));
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await fs.rm(worktreePath, { recursive: true, force: true });
  await runCommand({
    command: "git",
    args: ["worktree", "add", "--detach", worktreePath, "HEAD"],
    cwd: repoRoot,
    timeoutMs: 30000
  });

  return {
    executionRoot: worktreePath,
    cleanup: async () => {}
  };
}

async function isWorkingTreeDirty(repoRoot: string): Promise<boolean> {
  const result = await runCommand({
    command: "git",
    args: ["status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).orchestra/**"],
    cwd: repoRoot,
    timeoutMs: 30000
  });
  return result.stdout.trim().length > 0;
}

function sanitizeJobId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "job";
}
