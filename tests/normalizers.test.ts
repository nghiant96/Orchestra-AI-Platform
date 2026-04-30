import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePersistedRunState, normalizeQueueJob, normalizeAuditEvent } from "../ai-system/core/normalizers.js";

test("normalizePersistedRunState handles missing fields and old version", () => {
  const oldState = {
    task: "old task",
    status: "completed",
    plan: { prompt: "old prompt", readFiles: [], writeTargets: [], notes: [] }
  };

  const normalized = normalizePersistedRunState(oldState);
  assert.strictEqual(normalized.version, 1);
  assert.strictEqual(normalized.task, "old task");
  assert.deepEqual(normalized.iterations, []);
  assert.deepEqual(normalized.skippedContextFiles, []);
  assert.deepEqual(normalized.finalIssues, []);
});

test("normalizeQueueJob handles missing version", () => {
  const oldJob = {
    jobId: "job-1",
    task: "test task",
    cwd: "/tmp",
    dryRun: true
  };

  const normalized = normalizeQueueJob(oldJob);
  assert.strictEqual(normalized.version, 1);
  assert.strictEqual(normalized.status, "failed"); // fallback
  assert.strictEqual(normalized.task, "test task");
});

test("normalizeAuditEvent handles missing version", () => {
  const oldEvent = {
    id: "evt-1",
    action: "test.action",
    actor: { id: "user-1", role: "admin" }
  };

  const normalized = normalizeAuditEvent(oldEvent);
  assert.strictEqual(normalized.version, 1);
  assert.strictEqual(normalized.action, "test.action");
  assert.ok(normalized.timestamp);
});
