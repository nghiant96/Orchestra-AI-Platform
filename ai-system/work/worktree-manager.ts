import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/api.js";

export async function createWorktree(repoRoot: string, branchName: string, worktreePath: string): Promise<void> {
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await runCommand({
    command: "git",
    args: ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
    cwd: repoRoot
  });
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await runCommand({
    command: "git",
    args: ["worktree", "remove", "--force", worktreePath],
    cwd: repoRoot
  });
}
