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

test("SQLite job queue migrates legacy file-backed jobs on startup", async () => {
  const previous = process.env.ORCHESTRA_STORE;
  process.env.ORCHESTRA_STORE = "sqlite";

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestra-sqlite-migrate-"));
  const jobsDir = resolveJobQueueDirectory(tmpDir);

  try {
    await fs.mkdir(jobsDir, { recursive: true });
    const legacyJob = {
      version: 1,
      jobId: "job-legacy-migrate",
      status: "queued",
      task: "legacy migration test",
      cwd: tmpDir,
      dryRun: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifactPath: null,
      resultSummary: null,
      error: null
    };
    await fs.writeFile(path.join(jobsDir, "job-legacy-migrate.json"), JSON.stringify(legacyJob, null, 2), "utf8");

    const queue = new FileBackedJobQueue(jobsDir, async () => {
      throw new Error("runner should not be invoked");
    });
    queue.setPaused(true);

    const imported = await queue.migrateLegacyJobsFromDisk();
    assert.equal(imported >= 1, true);

    const job = await queue.get("job-legacy-migrate");
    assert.ok(job);
    assert.equal(job?.task, "legacy migration test");

    await queue.stop();
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRA_STORE;
    } else {
      process.env.ORCHESTRA_STORE = previous;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("SQLite job queue migration schedules legacy jobs for execution", async () => {
  const previous = process.env.ORCHESTRA_STORE;
  process.env.ORCHESTRA_STORE = "sqlite";

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestra-sqlite-migrate-run-"));
  const jobsDir = resolveJobQueueDirectory(tmpDir);

  try {
    await fs.mkdir(jobsDir, { recursive: true });
    const legacyJob = {
      version: 1,
      jobId: "job-legacy-run",
      status: "queued",
      task: "legacy migration run test",
      cwd: tmpDir,
      dryRun: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifactPath: null,
      resultSummary: null,
      error: null
    };
    await fs.writeFile(path.join(jobsDir, "job-legacy-run.json"), JSON.stringify(legacyJob, null, 2), "utf8");

    const queue = new FileBackedJobQueue(jobsDir, async () => ({
      version: 1,
      ok: true,
      status: "completed",
      dryRun: true,
      repoRoot: tmpDir,
      configPath: null,
      plan: { prompt: "legacy migration run test", readFiles: [], writeTargets: [], notes: [] },
      result: { summary: "done", files: [], tools: [], errors: [] } as any,
      iterations: [],
      issueCounts: {},
      skippedContextFiles: [],
      finalIssues: [],
      providers: {} as any,
      memory: {} as any,
      artifacts: {
        enabled: true,
        ok: true,
        runPath: path.join(tmpDir, ".ai-system-artifacts", "legacy-run"),
        latestIterationPath: null,
        stepPaths: {},
        latestFiles: []
      },
      wroteFiles: false,
      execution: {
        currentStage: null,
        terminalStage: null,
        steps: [],
        transitions: [],
        failure: null,
        retryHint: null,
        providerMetrics: [],
        budget: null,
        totalDurationMs: 1
      }
    }), { concurrency: 1 });

    queue.start();
    await queue.migrateLegacyJobsFromDisk();

    await waitFor(async () => {
      const job = await queue.get("job-legacy-run");
      return job?.status === "completed";
    });

    await queue.stop();
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRA_STORE;
    } else {
      process.env.ORCHESTRA_STORE = previous;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for migrated job to complete");
}
