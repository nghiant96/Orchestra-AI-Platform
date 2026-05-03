import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../ai-system/utils/api.js";
import { WorkStore } from "../ai-system/work/work-store.js";
import { commitWorkItemChanges, generateWorkItemCommitMessage, generateWorkItemPRBody, previewGhPR } from "../ai-system/work/commit-pr.js";
import { importExternalTaskToWorkItem } from "../ai-system/work/inbox.js";
import { watchCiForWorkItem, proposeCiRepairTask } from "../ai-system/work/ci.js";
import { scheduleWorkItems } from "../ai-system/work/scheduler.js";

test("W7-W11 workspace helpers cover commit, PR, inbox, CI, and scheduling", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-w7-11-"));
  try {
    await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
    await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
    await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
    await fs.writeFile(path.join(repoRoot, "README.md"), "# test\n", "utf8");
    await runCommand({ command: "git", args: ["add", "README.md"], cwd: repoRoot });
    await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });

    const store = new WorkStore(repoRoot, { artifacts: { data_dir: ".ai-system-artifacts" } } as any);
    const workItem = await store.create({
      title: "Fix flaky login",
      projectId: "demo",
      type: "bugfix",
      appliedFiles: ["README.md"],
      ci: { status: "failing", failingChecks: ["pnpm test"], repairAttempts: 0, maxRepairAttempts: 2 }
    } as any);

    const message = generateWorkItemCommitMessage(workItem, ["README.md"], "summary");
    assert.match(message, /Fix flaky login/);

    await fs.writeFile(path.join(repoRoot, "README.md"), "# updated\n", "utf8");
    const commitPlan = await commitWorkItemChanges(repoRoot, workItem, ["README.md"]);
    assert.equal(commitPlan.filesChanged[0], "README.md");

    const prBody = generateWorkItemPRBody(workItem, "work/fix-flaky-login", ["README.md"]);
    const preview = previewGhPR(prBody, repoRoot);
    assert.match(preview.command, /gh pr create/);

    const imported = await importExternalTaskToWorkItem(store, "https://github.com/acme/demo/issues/12");
    assert.ok(imported);
    assert.equal(imported?.externalTask?.number, 12);

    const ci = await watchCiForWorkItem({ ...workItem, ci: { status: "failing", failingChecks: ["pnpm test"] } } as any, repoRoot);
    assert.equal(ci.repairNeeded, true);
    assert.match(proposeCiRepairTask(workItem, ci), /Fix CI/);

    const plan = scheduleWorkItems([
      { ...workItem, id: "work-a", status: "executing", branch: "work/a", worktreePath: "/tmp/a" } as any,
      { ...workItem, id: "work-b", status: "created", branch: "work/a", worktreePath: "/tmp/a" } as any
    ]);
    assert.equal(plan.ready.length, 1);
    assert.equal(plan.blocked.length, 1);

    // Tier-aware ordering: cheaper tiers should sort first
    const tieredPlan = scheduleWorkItems([
      { ...workItem, id: "w-feature", type: "feature", status: "created", branch: "w1", worktreePath: "/w1" } as any,
      { ...workItem, id: "w-docs", type: "docs", status: "created", branch: "w2", worktreePath: "/w2" } as any,
      { ...workItem, id: "w-refactor", type: "refactor", status: "created", branch: "w3", worktreePath: "/w3" } as any,
      { ...workItem, id: "w-test", type: "test", status: "created", branch: "w4", worktreePath: "/w4" } as any,
      { ...workItem, id: "w-bugfix", type: "bugfix", status: "created", branch: "w5", worktreePath: "/w5" } as any
    ]);
    assert.equal(tieredPlan.ready.length, 5);
    assert.equal(tieredPlan.blocked.length, 0);
    // docs/config/investigation are tier 0, test/bugfix/review are tier 1, refactor/feature are tier 2
    assert.equal(tieredPlan.ready[0].id, "w-docs"); // tier 0
    assert.equal(tieredPlan.ready[1].id, "w-test"); // tier 1
    assert.equal(tieredPlan.ready[2].id, "w-bugfix"); // tier 1, shorter deps than w-test (both 0) -> falls after by stable sort
    assert.equal(tieredPlan.ready[3].id, "w-feature"); // tier 2 (listed first, stable sort)
    assert.equal(tieredPlan.ready[4].id, "w-refactor"); // tier 2

    // Max parallel: only 2 should be ready when cap is 2
    const cappedPlan = scheduleWorkItems([
      { ...workItem, id: "w-a", status: "created", branch: "b1", worktreePath: "/b1" } as any,
      { ...workItem, id: "w-b", status: "created", branch: "b2", worktreePath: "/b2" } as any,
      { ...workItem, id: "w-c", status: "created", branch: "b3", worktreePath: "/b3" } as any
    ], { maxParallel: 2 });
    assert.equal(cappedPlan.ready.length, 2);
    assert.equal(cappedPlan.blocked.length, 1);
    assert.match(cappedPlan.blocked[0].conflicts[0].reason, /Max parallel/);

    // Failed + cancelled items are always blocked
    const statusPlan = scheduleWorkItems([
      { ...workItem, id: "w-fail", status: "failed", branch: "f1", worktreePath: "/f1" } as any,
      { ...workItem, id: "w-cancel", status: "cancelled", branch: "f2", worktreePath: "/f2" } as any,
      { ...workItem, id: "w-ok", status: "created", branch: "f3", worktreePath: "/f3" } as any
    ]);
    assert.equal(statusPlan.ready.length, 1);
    assert.equal(statusPlan.ready[0].id, "w-ok");
    assert.equal(statusPlan.blocked.length, 2);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
