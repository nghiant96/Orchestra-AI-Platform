import path from "node:path";
import { createGitBranch, generateSafeBranchName } from "../core/git-workflow.js";
import { runCommand } from "../utils/api.js";
export function planWorkItemBranch(workItem, runId, externalTask) {
    return generateSafeBranchName(workItem.title || workItem.description || "work item", runId, externalTask, {
        prefix: "work/"
    });
}
export async function prepareWorkItemBranch(repoRoot, workItem, runId, externalTask) {
    if (await hasBlockingChanges(repoRoot)) {
        throw new Error("Repository has uncommitted changes. Commit or stash before creating a work branch.");
    }
    const plan = planWorkItemBranch(workItem, runId, externalTask);
    await createGitBranch(repoRoot, plan.branchName);
    return plan;
}
export function deriveWorktreePath(repoRoot, workItemId) {
    return path.join(repoRoot, ".ai-system-worktrees", workItemId);
}
async function hasBlockingChanges(repoRoot) {
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
