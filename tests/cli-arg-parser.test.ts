import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, normalizeRetryStage } from "../ai-system/cli/arg-parser.js";

describe("CLI Arg Parser", () => {
  it("parses empty args correctly", async () => {
    // Need to pass mock process.cwd or mock the fact that we can't test readTaskFromStdin easily
    // We'll mock process.stdin.isTTY = true for tests if we can, but it defaults to that mostly in tests
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      const options = await parseArgs([]);
      assert.equal(options.chat, false);
      assert.equal(options.dryRun, false);
      assert.equal(options.interactive, false);
      assert.equal(options.workflowMode, "standard");
      assert.equal(options.command, null);
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("parses --dry-run and --interactive correctly", async () => {
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      const options = await parseArgs(["my", "task", "--dry-run", "--interactive"]);
      assert.equal(options.task, "my task");
      assert.equal(options.dryRun, true);
      assert.equal(options.interactive, true);
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("parses review mode with staged files", async () => {
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      const options = await parseArgs(["review", "--staged"]);
      assert.equal(options.workflowMode, "review");
      assert.equal(options.reviewStaged, true);
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("parses commands like runs latest", async () => {
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      const options = await parseArgs(["runs", "latest"]);
      assert.deepEqual(options.command, { kind: "runs-latest" });
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("parses Solo Mode run commands", async () => {
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      const normal = await parseArgs(["run", "Fix login loading state"]);
      const dirty = await parseArgs(["run", "--allow-dirty", "Fix login loading state"]);
      const stashed = await parseArgs(["run", "--stash", "Fix login loading state"]);
      const worktree = await parseArgs(["run", "--worktree", "Fix login loading state"]);
      const quick = await parseArgs(["quick", "Fix README typo"]);
      const safe = await parseArgs(["safe", "Refactor payment session flow"]);

      assert.deepEqual(normal.command, { kind: "solo-run", executionMode: "normal" });
      assert.equal(normal.task, "Fix login loading state");
      assert.equal(normal.allowDirtyWorkingTree, false);
      assert.equal(dirty.allowDirtyWorkingTree, true);
      assert.equal(stashed.dirtyTreeMode, "stash");
      assert.equal(worktree.dirtyTreeMode, "worktree");
      assert.deepEqual(dirty.command, { kind: "solo-run", executionMode: "normal" });
      assert.equal(dirty.task, "Fix login loading state");
      assert.deepEqual(quick.command, { kind: "solo-run", executionMode: "quick" });
      assert.equal(quick.task, "Fix README typo");
      assert.deepEqual(safe.command, { kind: "solo-run", executionMode: "safe" });
      assert.equal(safe.task, "Refactor payment session flow");
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("rejects Solo Mode commands without a task", async () => {
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      await assert.rejects(() => parseArgs(["run"]), /Missing task for `ai run`/);
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("parses Solo job productivity commands", async () => {
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      assert.deepEqual((await parseArgs(["job", "list"])).command, { kind: "solo-job-list" });
      assert.deepEqual((await parseArgs(["job", "show", "job-123"])).command, {
        kind: "solo-job-show",
        target: "job-123"
      });
      assert.deepEqual((await parseArgs(["job", "logs", "last"])).command, {
        kind: "solo-job-logs",
        target: "last"
      });
      assert.deepEqual((await parseArgs(["undo", "last"])).command, {
        kind: "solo-undo",
        target: "last"
      });
      assert.deepEqual((await parseArgs(["diff", "explain"])).command, {
        kind: "solo-diff-explain",
        target: "last"
      });
      assert.deepEqual((await parseArgs(["diff", "explain", "job-123"])).command, {
        kind: "solo-diff-explain",
        target: "job-123"
      });
      assert.deepEqual((await parseArgs(["continue"])).command, {
        kind: "solo-continue",
        target: "last",
        fixVerification: false
      });
      assert.deepEqual((await parseArgs(["continue", "--job", "job-123"])).command, {
        kind: "solo-continue",
        target: "job-123",
        fixVerification: false
      });
      assert.deepEqual((await parseArgs(["continue", "--fix-verification"])).command, {
        kind: "solo-continue",
        target: "last",
        fixVerification: true
      });
      assert.deepEqual((await parseArgs(["commit", "job-123"])).command, {
        kind: "solo-commit",
        target: "job-123"
      });
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("parses worker start command options", async () => {
    const origIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      const options = await parseArgs([
        "worker",
        "start",
        "--server-url",
        "http://127.0.0.1:9999",
        "--token",
        "worker-token",
        "--name",
        "local-worker",
        "--labels",
        "mac,ios",
        "--workspace-roots",
        "/tmp/project-a,/tmp/project-b",
        "--heartbeat-interval",
        "2500",
        "--poll-interval",
        "500",
        "--once"
      ]);

      assert.deepEqual(options.command, {
        kind: "worker-start",
        serverUrl: "http://127.0.0.1:9999",
        workerToken: "worker-token",
        workerName: "local-worker",
        workerLabels: ["mac", "ios"],
        workspaceRoots: ["/tmp/project-a", "/tmp/project-b"],
        heartbeatIntervalMs: 2500,
        pollIntervalMs: 500,
        once: true
      });
    } finally {
      process.stdin.isTTY = origIsTTY;
    }
  });

  it("normalizeRetryStage handles valid stages", () => {
    assert.equal(normalizeRetryStage("review"), "iteration-review");
    assert.equal(normalizeRetryStage("check"), "iteration-tools");
    assert.equal(normalizeRetryStage("generation"), "iteration-generate");
  });

  it("normalizeRetryStage throws on invalid stage", () => {
    assert.throws(() => normalizeRetryStage("invalid"), /Unsupported retry stage/);
  });
});
