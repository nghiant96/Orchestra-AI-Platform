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

    const ci = watchCiForWorkItem({ ...workItem, ci: { status: "failing", failingChecks: ["pnpm test"] } } as any);
    assert.equal(ci.repairNeeded, true);
    assert.match(proposeCiRepairTask(workItem, ci), /Fix CI/);

    const plan = scheduleWorkItems([
      { ...workItem, id: "work-a", status: "executing", branch: "work/a", worktreePath: "/tmp/a" } as any,
      { ...workItem, id: "work-b", status: "created", branch: "work/a", worktreePath: "/tmp/a" } as any
    ]);
    assert.equal(plan.ready.length, 1);
    assert.equal(plan.blocked.length, 1);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
