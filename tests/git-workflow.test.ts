import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateSafeBranchName,
  generateCommitMessage,
  generatePRDescription,
  generatePRPreview
} from "../ai-system/core/git-workflow.js";

test("generateSafeBranchName generates from task text", () => {
  const task = "Fix the login bug in auth component";
  const runId = "run-1234567890";
  const result = generateSafeBranchName(task, runId);

  assert.strictEqual(result.source, "task_text");
  assert.ok(result.branchName.startsWith("codex/fix-the-login-bug-in-"));
  assert.ok(result.branchName.endsWith("-567890"));
});

test("generateSafeBranchName generates from external task", () => {
  const task = "Implement feature X";
  const runId = "run-000000";
  const externalTask: import("../ai-system/types.js").ExternalTaskRef = {
    provider: "github",
    kind: "issue",
    url: "https://github.com/owner/repo/issues/123",
    owner: "owner",
    repo: "repo",
    number: 123
  };
  const result = generateSafeBranchName(task, runId, externalTask);

  assert.strictEqual(result.source, "external_task");
  assert.strictEqual(result.branchName, "codex/issue-123-000000");
});

test("generateSafeBranchName sanitizes symbols", () => {
  const task = "Update @types/node & check $ENV_VAR";
  const runId = "run-abcdef";
  const result = generateSafeBranchName(task, runId);

  assert.ok(!result.branchName.includes("@"));
  assert.ok(!result.branchName.includes("&"));
  assert.ok(!result.branchName.includes("$"));
  assert.ok(result.branchName.includes("types-node"));
});

test("generateSafeBranchName handles empty/weird input", () => {
  assert.ok(generateSafeBranchName("", "id-123").branchName.includes("work"));
  assert.ok(generateSafeBranchName("!!!", "id-123").branchName.includes("work"));
});

test("generateSafeBranchName respects custom prefix", () => {
  const result = generateSafeBranchName("task", "id", undefined, { prefix: "feat/" });
  assert.ok(result.branchName.startsWith("feat/"));
});

test("generateCommitMessage generates concise message", () => {
  const task = "Fix auth bug\nMore details here";
  const files = ["src/auth.ts"];
  const externalTask: import("../ai-system/types.js").ExternalTaskRef = {
    provider: "github",
    kind: "issue",
    url: "https://github.com/owner/repo/issues/123",
    owner: "owner",
    repo: "repo",
    number: 123,
    title: "Auth Bug"
  };
  
  const msg = generateCommitMessage(task, files, externalTask, { summary: "Fixed it", ok: true });
  
  assert.ok(msg.startsWith("issue(#123): Auth Bug"));
  assert.ok(msg.includes("Applied files:"));
  assert.ok(msg.includes("- src/auth.ts"));
  assert.ok(msg.includes("Run summary: Fixed it"));
});

test("generatePRDescription generates detailed description", () => {
  const task = "Fix auth bug";
  const files = ["src/auth.ts"];
  const runResult: any = {
    plan: { notes: ["Note 1"] },
    result: { summary: "Implementation summary" },
    latestToolResults: [{ name: "lint", ok: true, summary: "passed" }],
    missingTests: [{ name: "Test 1", description: "Desc 1", status: "passed" }],
    artifacts: { runPath: "/tmp/run" }
  };
  
  const desc = generatePRDescription(task, files, runResult);
  
  assert.ok(desc.includes("## Summary"));
  assert.ok(desc.includes("Implementation summary"));
  assert.ok(desc.includes("## Implementation Notes"));
  assert.ok(desc.includes("- Note 1"));
  assert.ok(desc.includes("## Verification Results"));
  assert.ok(desc.includes("PASS **lint**: passed"));
  assert.ok(desc.includes("## Artifacts"));
});

test("generatePRPreview generates a valid preview object", () => {
  const runResult: any = {
    plan: { notes: [] },
    result: { summary: "summary" },
    latestToolResults: [],
    artifacts: {}
  };
  
  const preview = generatePRPreview("feat-branch", "task", ["file1.ts"], runResult);
  
  assert.strictEqual(preview.action, "create_pr");
  assert.strictEqual(preview.approved, false);
  assert.strictEqual((preview.payload as any).head, "feat-branch");
  assert.ok(preview.body?.includes("## Summary"));
});
