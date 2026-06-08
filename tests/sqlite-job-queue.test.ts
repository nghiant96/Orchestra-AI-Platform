import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileBackedJobQueue, resolveJobQueueDirectory } from "../ai-system/core/job-queue.js";

test("SQLite job queue survives restart and preserves claims", async () => {
  const previous = process.env.ORCHESTRA_STORE;
  process.env.ORCHESTRA_STORE = "sqlite";

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestra-sqlite-queue-"));
  const jobsDir = resolveJobQueueDirectory(tmpDir);

  const runner = async () => {
    throw new Error("runner should not be invoked in this durability test");
  };

  const firstQueue = new FileBackedJobQueue(jobsDir, runner, { concurrency: 1 });
  firstQueue.setPaused(true);

  try {
    const created = await firstQueue.enqueue({
      task: "durable sqlite queue test",
      cwd: tmpDir,
      dryRun: true
    });

    await firstQueue.stop();

    const secondQueue = new FileBackedJobQueue(jobsDir, runner, { concurrency: 1 });
    secondQueue.setPaused(true);

    const lease = {
      workerId: "worker-sqlite-test",
      leaseId: "lease-sqlite-test",
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastHeartbeatAt: new Date().toISOString()
    };

    const claimed = await secondQueue.claimJob(created.jobId, lease);
    assert.ok(claimed);
    assert.equal(claimed?.status, "assigned");
    assert.equal(claimed?.lease?.leaseId, lease.leaseId);

    await secondQueue.stop();

    const thirdQueue = new FileBackedJobQueue(jobsDir, runner, { concurrency: 1 });
    thirdQueue.setPaused(true);

    const persisted = await thirdQueue.get(created.jobId);
    assert.ok(persisted);
    assert.equal(persisted?.status, "assigned");
    assert.equal(persisted?.lease?.leaseId, lease.leaseId);

    const listed = await thirdQueue.list(10);
    assert.ok(listed.some((job) => job.jobId === created.jobId));

    await thirdQueue.stop();
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRA_STORE;
    } else {
      process.env.ORCHESTRA_STORE = previous;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
