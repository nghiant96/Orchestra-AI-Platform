import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileBackedJobQueue, type JobLease, type JobRunner, type QueueJob, type QueueJobStatus } from "../ai-system/core/job-queue.js";
import { waitForApproval, type PendingApproval } from "../ai-system/approvals/approval-wait.js";
import { removeTempDir, silentLogger } from "./test-utils.js";

const OLD = "2020-01-01T00:00:00.000Z";

const okResult = { version: 1, ok: true, status: "completed" } as any;
const idleRunner: JobRunner = async () => okResult;

async function withQueue(
  runner: JobRunner,
  fn: (queue: FileBackedJobQueue, jobsDir: string) => Promise<void>,
  options: { retentionDays?: number } = {}
): Promise<void> {
  const jobsDir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-integrity-"));
  const queue = new FileBackedJobQueue(jobsDir, runner, { logger: silentLogger(), ...options });
  try {
    await fn(queue, jobsDir);
  } finally {
    await queue.stop();
    await removeTempDir(jobsDir);
  }
}

async function seed(jobsDir: string, jobId: string, status: QueueJobStatus, extra: Partial<QueueJob> = {}): Promise<void> {
  const job: QueueJob = { version: 1, jobId, status, task: jobId, cwd: "/repo", dryRun: true, createdAt: OLD, updatedAt: OLD, ...extra };
  await fs.writeFile(path.join(jobsDir, `${jobId}.json`), JSON.stringify(job), "utf8");
}

function lease(workerId = "worker-a", leaseId = "lease-1"): JobLease {
  const now = new Date();
  return {
    workerId,
    leaseId,
    claimedAt: now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString()
  };
}

async function waitFor<T>(probe: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await probe();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("age-based retention prunes finished jobs only", async () => {
  await withQueue(idleRunner, async (queue, jobsDir) => {
    await seed(jobsDir, "old-completed", "completed");
    await seed(jobsDir, "old-cancelled", "cancelled");
    await seed(jobsDir, "old-queued", "queued");
    await seed(jobsDir, "old-waiting", "waiting_for_approval");
    await seed(jobsDir, "old-stalled", "stalled");

    await queue.runRetentionCleanup();

    assert.equal(await queue.get("old-completed"), null);
    assert.equal(await queue.get("old-cancelled"), null);
    assert.equal((await queue.get("old-queued"))?.status, "queued");
    assert.equal((await queue.get("old-waiting"))?.status, "waiting_for_approval");
    assert.equal((await queue.get("old-stalled"))?.status, "stalled");
  }, { retentionDays: 1 });
});

test("count-based retention never drops live work to make room", async () => {
  await withQueue(idleRunner, async (queue, jobsDir) => {
    // More queued jobs than the retention count used to keep in total.
    for (let index = 0; index < 105; index += 1) {
      await seed(jobsDir, `queued-${index}`, "queued", { createdAt: new Date(Date.UTC(2021, 0, 1, 0, 0, index)).toISOString() });
    }
    for (let index = 0; index < 102; index += 1) {
      await seed(jobsDir, `done-${index}`, "completed", { createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString() });
    }

    await queue.runRetentionCleanup();

    const remaining = await queue.list(500);
    assert.equal(remaining.filter((job) => job.status === "queued").length, 105);
    assert.equal(remaining.filter((job) => job.status === "completed").length, 100);
    // The two oldest finished records are the ones that went.
    assert.equal(await queue.get("done-0"), null);
    assert.equal(await queue.get("done-1"), null);
  });
});

test("a cancelled worker job cannot be flipped back by complete or fail", async () => {
  await withQueue(idleRunner, async (queue, jobsDir) => {
    await seed(jobsDir, "claimed", "queued");
    const claimed = await queue.claimJob("claimed", lease());
    assert.equal(claimed?.status, "assigned");

    // Claimed but not yet started: cancel used to leave this untouched.
    const cancelled = await queue.cancel("claimed");
    assert.equal(cancelled?.status, "cancelled");

    assert.deepEqual(await queue.completeJob("claimed", "lease-1", { resultSummary: "late result" }), { ok: false, error: "Job was cancelled" });
    assert.deepEqual(await queue.failJob("claimed", "lease-1", "late failure"), { ok: false, error: "Job was cancelled" });
    assert.equal((await queue.get("claimed"))?.status, "cancelled");
    assert.equal((await queue.get("claimed"))?.resultSummary, "Job cancelled by user.");
  });
});

test("a cancelled running worker job stays cancelled", async () => {
  await withQueue(idleRunner, async (queue, jobsDir) => {
    await seed(jobsDir, "running-job", "queued");
    await queue.claimJob("running-job", lease());
    assert.deepEqual(await queue.startJob("running-job", "worker-a", "lease-1"), { ok: true });

    await queue.cancel("running-job");
    const completion = await queue.completeJob("running-job", "lease-1", {});

    assert.equal(completion.ok, false);
    assert.equal((await queue.get("running-job"))?.status, "cancelled");
  });
});

test("completing a job that already failed is reported, not silently dropped", async () => {
  await withQueue(idleRunner, async (queue, jobsDir) => {
    await seed(jobsDir, "failed-first", "queued");
    await queue.claimJob("failed-first", lease());
    await queue.startJob("failed-first", "worker-a", "lease-1");
    assert.deepEqual(await queue.failJob("failed-first", "lease-1", "boom"), { ok: true });

    assert.deepEqual(await queue.completeJob("failed-first", "lease-1", {}), { ok: false, error: "Job already failed" });
    // A repeated fail is still idempotent.
    assert.deepEqual(await queue.failJob("failed-first", "lease-1", "boom"), { ok: true });
  });
});

test("a server restart fails orphaned in-process runs but leaves worker-leased jobs alone", async () => {
  await withQueue(idleRunner, async (queue, jobsDir) => {
    await seed(jobsDir, "in-process", "running");
    await seed(jobsDir, "on-worker", "running", { lease: lease(), workerId: "worker-a" });

    queue.start();
    const orphan = await waitFor(() => queue.get("in-process"), (job) => job?.status === "failed", "orphan cleanup");
    assert.match(orphan?.error ?? "", /interrupted by server restart/);
    assert.equal((await queue.get("on-worker"))?.status, "running");

    // The worker that outlived the restart can still report its result.
    assert.deepEqual(await queue.completeJob("on-worker", "lease-1", { resultSummary: "done" }), { ok: true });
    assert.equal((await queue.get("on-worker"))?.status, "completed");
  });
});

test("cancelling a job that waits for approval frees its workspace for the next job", async () => {
  const pendingApprovals = new Map<string, PendingApproval>();
  const runner: JobRunner = async ({ jobId, signal }) => {
    const approved = await waitForApproval({ jobId, type: "plan", data: { jobId }, pendingApprovals, signal });
    return { ...okResult, ok: approved };
  };

  await withQueue(runner, async (queue) => {
    queue.start();
    const first = await queue.enqueue({ task: "first", cwd: "/repo", dryRun: true });
    await waitFor(async () => pendingApprovals.has(first.jobId), Boolean, "first job to wait for approval");

    await queue.cancel(first.jobId);
    assert.equal(pendingApprovals.has(first.jobId), false);

    // Same workspace: this only runs once the first run has let go of it.
    const second = await queue.enqueue({ task: "second", cwd: "/repo", dryRun: true });
    await waitFor(async () => pendingApprovals.has(second.jobId), Boolean, "second job to start");
    pendingApprovals.get(second.jobId)?.resolve(true);

    await waitFor(() => queue.get(second.jobId), (job) => job?.status === "completed", "second job to complete");
    assert.equal((await queue.get(first.jobId))?.status, "cancelled");
  });
});

test("waiting-for-approval is not written over a job that was already cancelled", async () => {
  await withQueue(idleRunner, async (queue, jobsDir) => {
    await seed(jobsDir, "gone", "cancelled");
    await queue.markWaitingForApproval("gone", () => ({ resultSummary: "Plan ready" }));
    assert.equal((await queue.get("gone"))?.status, "cancelled");
  });
});

test("a store failure while draining is retried instead of crashing the process", async () => {
  await withQueue(idleRunner, async (queue) => {
    // Fail the first two scans: start()'s orphan cleanup, then the first drain.
    // Both used to reject with nothing attached, which crashes the process.
    const realList = queue.list.bind(queue);
    let failures = 2;
    queue.list = async (limit?: number) => {
      if (limit === 100 && failures > 0) {
        failures -= 1;
        throw new Error("store unavailable");
      }
      return realList(limit);
    };

    queue.start();
    const job = await queue.enqueue({ task: "after outage", cwd: "/repo", dryRun: true });
    await waitFor(() => queue.get(job.jobId), (current) => current?.status === "completed", "job to run after the outage");
  });
});
