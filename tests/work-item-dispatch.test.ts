import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileBackedJobQueue, resolveJobQueueDirectory } from "../ai-system/core/job-queue.js";
import { FileAuditLog, resolveAuditLogPath } from "../ai-system/core/audit-log.js";
import { WorkStore } from "../ai-system/work/work-store.js";
import { loadRules } from "../ai-system/core/orchestrator-runtime.js";
import { createWorkItem, dispatchReadyWorkItems } from "../ai-system/work/work-item-service.js";
import { removeTempDir } from "./test-utils.js";

/**
 * Before this existed, `scheduleWorkItems` could compute a batch plan but the
 * only caller printed the counts and discarded it — no multi-item dispatch was
 * reachable from anywhere. These tests pin the behaviour that closes that gap.
 */
describe("dispatchReadyWorkItems", () => {
  let tmpDir: string;
  let queue: FileBackedJobQueue;
  let auditLog: FileAuditLog;

  test.before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-dispatch-test-"));
    queue = new FileBackedJobQueue(resolveJobQueueDirectory(tmpDir), async () => ({}) as any);
    // Nothing should execute during dispatch; the batch only queues work.
    queue.setPaused(true);
    auditLog = new FileAuditLog(resolveAuditLogPath(tmpDir));
  });

  test.after(async () => {
    await queue.stop();
    await removeTempDir(tmpDir);
  });

  const ctx = () => ({
    queue,
    auditLog,
    actor: { id: "dispatch-test", role: "operator" as const },
    rules: { artifacts: { data_dir: ".test-artifacts" } } as any
  });

  test("queues a job for every scheduler-ready work item", async () => {
    const titles = ["Dispatch alpha", "Dispatch beta", "Dispatch gamma"];
    for (const title of titles) {
      const created = await createWorkItem(ctx(), tmpDir, { title, description: title });
      assert.equal(created.ok, true);
    }

    const before = (await queue.list(200)).length;
    const result = await dispatchReadyWorkItems(ctx(), tmpDir, { dryRun: true });

    assert.equal(result.ok, true, `dispatch reported failures: ${JSON.stringify(result.failed)}`);
    assert.equal(result.dispatched.length, titles.length, "every ready item should dispatch");

    // The point of the whole exercise: real jobs land in the queue.
    const queuedJobIds = result.dispatched.flatMap((entry) => entry.jobIds);
    assert.ok(queuedJobIds.length >= titles.length, "each dispatched item should produce at least one job");
    const after = await queue.list(200);
    assert.equal(after.length, before + queuedJobIds.length);
    for (const jobId of queuedJobIds) {
      assert.ok(await queue.get(jobId), `job ${jobId} should be readable from the queue`);
    }

    // Every dispatched item must be traceable to the jobs that carry it.
    // Read through the same rules the service resolves, or the store points at
    // a different directory than the one that was written.
    const { rules } = await loadRules(tmpDir);
    const store = new WorkStore(tmpDir, rules);
    for (const entry of result.dispatched) {
      const item = await store.load(entry.workItemId);
      assert.ok(item, `work item ${entry.workItemId} should still exist`);
      const attachedRunIds = (item.graph?.nodes ?? [])
        .map((node) => node.assignedRunId)
        .filter(Boolean);
      assert.ok(
        entry.jobIds.some((jobId) => attachedRunIds.includes(jobId)),
        `work item ${entry.workItemId} should record its queued run ids`
      );
    }
  });

  test("maxParallel caps how many items go out in one batch", async () => {
    const capDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-dispatch-cap-"));
    const capQueue = new FileBackedJobQueue(resolveJobQueueDirectory(capDir), async () => ({}) as any);
    capQueue.setPaused(true);
    const capCtx = () => ({
      queue: capQueue,
      auditLog: new FileAuditLog(resolveAuditLogPath(capDir)),
      actor: { id: "dispatch-test", role: "operator" as const },
      rules: { artifacts: { data_dir: ".test-artifacts" } } as any
    });

    try {
      for (const title of ["Cap one", "Cap two", "Cap three", "Cap four"]) {
        await createWorkItem(capCtx(), capDir, { title, description: title });
      }

      const result = await dispatchReadyWorkItems(capCtx(), capDir, { dryRun: true, maxParallel: 2 });

      assert.equal(result.dispatched.length, 2, "cap should limit the dispatched batch");
      assert.equal(result.blocked.length, 2, "the remainder should be reported as blocked, not dropped");
      for (const blocked of result.blocked) {
        assert.match(blocked.reasons.join(" "), /Max parallel/);
      }
    } finally {
      await capQueue.stop();
      await removeTempDir(capDir);
    }
  });

  test("dispatching an empty backlog is a no-op rather than an error", async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-dispatch-empty-"));
    const emptyQueue = new FileBackedJobQueue(resolveJobQueueDirectory(emptyDir), async () => ({}) as any);
    emptyQueue.setPaused(true);

    try {
      const result = await dispatchReadyWorkItems(
        {
          queue: emptyQueue,
          auditLog: new FileAuditLog(resolveAuditLogPath(emptyDir)),
          actor: { id: "dispatch-test", role: "operator" as const },
          rules: { artifacts: { data_dir: ".test-artifacts" } } as any
        },
        emptyDir,
        { dryRun: true }
      );

      assert.equal(result.ok, true);
      assert.deepEqual(result.dispatched, []);
      assert.deepEqual(result.blocked, []);
      assert.deepEqual(result.failed, []);
    } finally {
      await emptyQueue.stop();
      await removeTempDir(emptyDir);
    }
  });

  test("the batch is audited so a PM run leaves a trail", async () => {
    const events = await auditLog.list(200);
    const dispatchEvent = events.find((event) => event.action === "work_item.dispatch");
    assert.ok(dispatchEvent, "dispatch should append an audit event");
    assert.equal((dispatchEvent.details as any)?.dispatchedCount, 3);
    assert.ok(Array.isArray((dispatchEvent.details as any)?.jobIds));
  });
});
