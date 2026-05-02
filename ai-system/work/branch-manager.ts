import path from "node:path";
import { createGitBranch, generateSafeBranchName } from "../core/git-workflow.js";
import { runCommand } from "../utils/api.js";
import type { ExternalTaskRef } from "../types.js";
import type { WorkItem } from "./work-item.js";

export interface BranchPlan {
  branchName: string;
  source: string;
  reason: string;
}

export function planWorkItemBranch(workItem: WorkItem, runId: string, externalTask?: ExternalTaskRef): BranchPlan {
  return generateSafeBranchName(workItem.title || workItem.description || "work item", runId, externalTask, {
    prefix: "work/"
  });
}

export async function prepareWorkItemBranch(repoRoot: string, workItem: WorkItem, runId: string, externalTask?: ExternalTaskRef): Promise<BranchPlan> {
  if (await hasBlockingChanges(repoRoot)) {
    throw new Error("Repository has uncommitted changes. Commit or stash before creating a work branch.");
  }
  const plan = planWorkItemBranch(workItem, runId, externalTask);
  await createGitBranch(repoRoot, plan.branchName);
  return plan;
}

export function deriveWorktreePath(repoRoot: string, workItemId: string): string {
  return path.join(repoRoot, ".ai-system-worktrees", workItemId);
}

async function hasBlockingChanges(repoRoot: string): Promise<boolean> {
  const result = await runCommand({
    command: "git",
    args: ["status", "--porcelain", "--untracked-files=all"],
    cwd: repoRoot
  });
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.some((line) => !line.includes(".ai-system-artifacts/work-items/"));
}
