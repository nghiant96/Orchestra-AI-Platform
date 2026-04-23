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

  it("normalizeRetryStage handles valid stages", () => {
    assert.equal(normalizeRetryStage("review"), "iteration-review");
    assert.equal(normalizeRetryStage("check"), "iteration-tools");
    assert.equal(normalizeRetryStage("generation"), "iteration-generate");
  });

  it("normalizeRetryStage throws on invalid stage", () => {
    assert.throws(() => normalizeRetryStage("invalid"), /Unsupported retry stage/);
  });
});
