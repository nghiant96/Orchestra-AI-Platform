import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../ai-system/utils/api.js";
import { planWorkItemBranch, deriveWorktreePath } from "../ai-system/work/branch-manager.js";
import { createWorktree } from "../ai-system/work/worktree-manager.js";
import { cleanupFinishedWorktree, cleanupWorkspaceLifecycle } from "../ai-system/work/worktree-cleanup.js";
import { WorkStore } from "../ai-system/work/work-store.js";

test("workspace branch and worktree helpers create safe metadata", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-test-"));
  try {
    await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
    await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
    await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
    await fs.writeFile(path.join(repoRoot, "README.md"), "# test\n", "utf8");
    await runCommand({ command: "git", args: ["add", "README.md"], cwd: repoRoot });
    await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });

    const store = new WorkStore(repoRoot, { artifacts: { data_dir: ".ai-system-artifacts" } } as any);
    const workItem = await store.create({ title: "Fix login bug", projectId: "demo", type: "bugfix" });
    const plan = planWorkItemBranch(workItem, "run-123");
    assert.ok(plan.branchName.startsWith("work/"));

    const worktreePath = deriveWorktreePath(repoRoot, workItem.id);
    await createWorktree(repoRoot, plan.branchName, worktreePath);
    await store.save({ ...workItem, branch: plan.branchName, worktreePath, updatedAt: new Date().toISOString() });

    const updated = await store.load(workItem.id);
    assert.equal(updated?.branch, plan.branchName);
    assert.equal(updated?.worktreePath, worktreePath);

    await cleanupFinishedWorktree(repoRoot, { ...updated!, status: "done" });
    await assert.rejects(() => fs.stat(worktreePath));

    await store.save({ ...updated!, worktreePath, status: "done", updatedAt: new Date().toISOString() });
    const report = await cleanupWorkspaceLifecycle(repoRoot, { artifacts: { data_dir: ".ai-system-artifacts" }, retention: { queue_days: 1 } } as any);
    assert.equal(typeof report.removedWorktrees, "number");
    assert.equal(report.repairedWorkItems >= 0, true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
