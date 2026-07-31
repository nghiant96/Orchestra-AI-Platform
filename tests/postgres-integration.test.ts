import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { PostgresJobRepository } from "../ai-system/core/postgres-job-repository.js";
import { PostgresAuditLog } from "../ai-system/core/postgres-audit-log.js";
import { PostgresWorkerStore } from "../ai-system/workers/postgres-worker-store.js";
import type { QueueJob } from "../ai-system/core/job-queue.js";
import { removeTempDir } from "./test-utils.js";

/**
 * These are the only tests that prove the Postgres backend runs at all — every
 * other Postgres test asserts wiring (`instanceof`) or reads JSON off disk.
 *
 * They need a real database. Set ORCHESTRA_TEST_POSTGRES_URL to run them:
 *
 *   docker compose --profile postgres up -d postgres
 *   ORCHESTRA_TEST_POSTGRES_URL=postgresql://orchestra:<password>@127.0.0.1:5432/orchestra pnpm test
 *
 * Without it they skip, so the default suite stays runnable with no daemon.
 * CI supplies the URL from a service container, which is what keeps the
 * HA-path claim honest.
 */
const connectionString = process.env.ORCHESTRA_TEST_POSTGRES_URL?.trim();
const skip = connectionString
  ? false
  : "ORCHESTRA_TEST_POSTGRES_URL is not set; skipping Postgres integration tests";

/**
 * A skipped suite reports success, which is how an unexercised backend gets
 * described as implemented. Environments that must run these — CI above all —
 * set ORCHESTRA_REQUIRE_POSTGRES_TESTS=1 so a missing database is a failure
 * rather than a quiet pass.
 */
test("Postgres integration tests are configured to run", {
  skip: process.env.ORCHESTRA_REQUIRE_POSTGRES_TESTS === "1"
    ? false
    : "not required in this environment"
}, () => {
  assert.ok(
    connectionString,
    "ORCHESTRA_REQUIRE_POSTGRES_TESTS=1 but ORCHESTRA_TEST_POSTGRES_URL is unset — the Postgres suite would have skipped"
  );
});

/** Isolate each run so concurrent or repeated runs cannot collide. */
function uniqueSuffix(label: string): string {
  return `${label}-${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function withPool(fn: (pool: Pool) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString, application_name: "orchestra-tests" });
  try {
    await fn(pool);
  } finally {
    await pool.end();
  }
}

function createJob(overrides: Partial<QueueJob> = {}): QueueJob {
  const now = new Date().toISOString();
  return {
    version: 1,
    jobId: uniqueSuffix("job"),
    status: "queued",
    task: "postgres integration task",
    cwd: "/workspace",
    dryRun: true,
    createdAt: now,
    updatedAt: now,
    artifactPath: null,
    resultSummary: null,
    error: null,
    ...overrides
  };
}

test("Postgres job repository round-trips a job through real SQL", { skip }, async () => {
  const jobsDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-jobs-"));
  try {
    await withPool(async (pool) => {
      const repository = new PostgresJobRepository(pool, jobsDir);
      const job = createJob();

      await repository.write(job);

      const loaded = await repository.get(job.jobId);
      assert.ok(loaded, "job should be readable back from Postgres");
      assert.equal(loaded.jobId, job.jobId);
      assert.equal(loaded.task, job.task);
      assert.equal(loaded.status, "queued");

      // Same primary key, new state — the upsert must update rather than throw.
      await repository.write({ ...job, status: "completed", resultSummary: "done" });
      const updated = await repository.get(job.jobId);
      assert.equal(updated?.status, "completed");
      assert.equal(updated?.resultSummary, "done");

      const listed = await repository.list(100);
      assert.ok(
        listed.some((entry) => entry.jobId === job.jobId),
        "written job should appear in list()"
      );

      assert.equal(await repository.delete(job.jobId), true);
      assert.equal(await repository.get(job.jobId), null);
      assert.equal(await repository.delete(job.jobId), false, "deleting twice should report no row");
    });
  } finally {
    await removeTempDir(jobsDir);
  }
});

test("Postgres job locks are mutually exclusive across pools", { skip }, async () => {
  const jobsDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-locks-"));
  try {
    // Two pools stand in for two control-plane nodes. This is the property the
    // whole HA story rests on: only one may hold a job's lock at a time.
    const poolA = new Pool({ connectionString, application_name: "orchestra-tests-a" });
    const poolB = new Pool({ connectionString, application_name: "orchestra-tests-b" });

    try {
      const repositoryA = new PostgresJobRepository(poolA, jobsDir);
      const repositoryB = new PostgresJobRepository(poolB, jobsDir);
      const job = createJob();
      await repositoryA.write(job);

      const lockA = await repositoryA.acquireLock(job.jobId);
      assert.ok(lockA, "first node should acquire the lock");

      const lockB = await repositoryB.acquireLock(job.jobId);
      assert.equal(lockB, null, "second node must not acquire a held lock");

      await lockA.release();

      const lockBAfterRelease = await repositoryB.acquireLock(job.jobId);
      assert.ok(lockBAfterRelease, "lock should be available once released");
      await lockBAfterRelease.release();

      await repositoryA.delete(job.jobId);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  } finally {
    await removeTempDir(jobsDir);
  }
});

test("Postgres worker store round-trips and deletes a worker", { skip }, async () => {
  await withPool(async (pool) => {
    const store = new PostgresWorkerStore(pool);
    const created = await store.create({
      name: uniqueSuffix("worker"),
      os: process.platform,
      arch: process.arch,
      labels: ["integration"],
      workspaceRoots: ["/workspace"]
    });

    try {
      const loaded = await store.load(created.id);
      assert.ok(loaded, "worker should be readable back from Postgres");
      assert.equal(loaded.name, created.name);
      assert.deepEqual(loaded.labels, ["integration"]);

      await store.save({ ...loaded, status: "busy" });
      assert.equal((await store.load(created.id))?.status, "busy");

      const listed = await store.list();
      assert.ok(listed.some((worker) => worker.id === created.id));
    } finally {
      assert.equal(await store.delete(created.id), true);
      assert.equal(await store.load(created.id), null);
    }
  });
});

test("Postgres audit log appends and reads back events", { skip }, async () => {
  await withPool(async (pool) => {
    const auditLog = new PostgresAuditLog(pool);
    const action = uniqueSuffix("integration.audit");

    const appended = await auditLog.append({
      actor: { id: "integration-test", role: "operator" },
      action,
      cwd: "/workspace",
      details: { source: "postgres-integration.test.ts" }
    });

    assert.ok(appended.id, "append should assign an id");
    assert.ok(appended.timestamp, "append should assign a timestamp");

    const events = await auditLog.list(200);
    const found = events.find((event) => event.action === action);
    assert.ok(found, "appended event should be readable back");
    assert.equal(found.actor.id, "integration-test");
  });
});

test("Postgres schema bootstrap is idempotent", { skip }, async () => {
  const jobsDir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-schema-"));
  try {
    // Every repository runs CREATE TABLE IF NOT EXISTS on first use. Two
    // instances against one database is the normal multi-node case, so it must
    // not race into a duplicate-object error.
    await withPool(async (pool) => {
      const first = new PostgresJobRepository(pool, jobsDir);
      const second = new PostgresJobRepository(pool, jobsDir);
      const [a, b] = await Promise.all([first.list(1), second.list(1)]);
      assert.ok(Array.isArray(a));
      assert.ok(Array.isArray(b));
    });
  } finally {
    await removeTempDir(jobsDir);
  }
});
