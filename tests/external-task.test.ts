import { test } from "node:test";
import assert from "node:assert";
import { parseExternalTask } from "../ai-system/core/external-task.js";

test("parseExternalTask parses valid GitHub Issue URLs", () => {
  const url = "https://github.com/owner/repo/issues/123";
  const result = parseExternalTask(url);
  assert.notStrictEqual(result, null);
  assert.strictEqual(result?.provider, "github");
  assert.strictEqual(result?.kind, "issue");
  assert.strictEqual(result?.owner, "owner");
  assert.strictEqual(result?.repo, "repo");
  assert.strictEqual(result?.number, 123);
});

test("parseExternalTask parses valid GitHub PR URLs", () => {
  const url = "https://github.com/owner/repo/pull/456";
  const result = parseExternalTask(url);
  assert.notStrictEqual(result, null);
  assert.strictEqual(result?.provider, "github");
  assert.strictEqual(result?.kind, "pull_request");
  assert.strictEqual(result?.owner, "owner");
  assert.strictEqual(result?.repo, "repo");
  assert.strictEqual(result?.number, 456);
});

test("parseExternalTask rejects non-GitHub URLs", () => {
  const url = "https://gitlab.com/owner/repo/issues/123";
  const result = parseExternalTask(url);
  assert.strictEqual(result, null);
});

test("parseExternalTask rejects unsupported GitHub paths", () => {
  assert.strictEqual(parseExternalTask("https://github.com/owner/repo/commit/abc"), null);
  assert.strictEqual(parseExternalTask("https://github.com/owner/repo/tree/main"), null);
  assert.strictEqual(parseExternalTask("https://github.com/owner/repo/actions/runs/1"), null);
});

test("parseExternalTask rejects invalid numbers", () => {
  const url = "https://github.com/owner/repo/issues/abc";
  const result = parseExternalTask(url);
  assert.strictEqual(result, null);
});

test("parseExternalTask rejects incomplete URLs", () => {
  assert.strictEqual(parseExternalTask("https://github.com/owner/repo/issues"), null);
  assert.strictEqual(parseExternalTask("https://github.com/owner/repo"), null);
  assert.strictEqual(parseExternalTask("https://github.com/owner"), null);
});
