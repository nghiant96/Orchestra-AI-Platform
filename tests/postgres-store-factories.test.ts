import assert from "node:assert/strict";
import test from "node:test";
import { FileJobRepository, SqliteJobRepository, createJobRecordRepository } from "../ai-system/core/job-repositories.js";
import { createWorkerStore, WorkerStore } from "../ai-system/workers/worker-store.js";
import { PostgresWorkerStore } from "../ai-system/workers/postgres-worker-store.js";
import { PostgresJobRepository } from "../ai-system/core/postgres-job-repository.js";

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

test("postgres store factories return postgres-backed repositories when requested", async () => {
  await withEnv("ORCHESTRA_STORE", "postgres", () => {
    const jobsRepository = createJobRecordRepository("/tmp/orchestra-postgres-test-jobs");
    assert.ok(jobsRepository instanceof PostgresJobRepository);

    const workerStore = createWorkerStore("/tmp/orchestra-postgres-test-workers");
    assert.ok(workerStore instanceof PostgresWorkerStore);
  });
});

test("store factories preserve file and sqlite backends when requested", async () => {
  await withEnv("ORCHESTRA_STORE", "file", () => {
    const jobsRepository = createJobRecordRepository("/tmp/orchestra-file-test-jobs");
    assert.ok(jobsRepository instanceof FileJobRepository);

    const workerStore = createWorkerStore("/tmp/orchestra-file-test-workers");
    assert.ok(workerStore instanceof WorkerStore);
  });

  await withEnv("ORCHESTRA_STORE", "sqlite", () => {
    const jobsRepository = createJobRecordRepository("/tmp/orchestra-sqlite-test-jobs");
    assert.ok(jobsRepository instanceof SqliteJobRepository);
  });
});
