import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { loadWorkerRuntimeConfig } from "../ai-system/worker/worker-config.js";
import { runWorkerRuntime } from "../ai-system/worker/worker-runtime.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir, waitForJobStatus } from "./test-utils.js";

const SERVER_TOKEN = "session-test-server-token";
const WORKER_TOKEN = "session-test-worker-token";
const server = { Authorization: `Bearer ${SERVER_TOKEN}`, "x-ai-system-role": "operator", "x-ai-system-actor": "session-test" };

async function withWorkerServer(fn: (baseUrl: string, repoRoot: string) => Promise<void>): Promise<void> {
  const previous = { worker: process.env.ORCHESTRA_WORKER_TOKEN, backend: process.env.ORCHESTRA_EXECUTION_BACKEND };
  process.env.ORCHESTRA_WORKER_TOKEN = WORKER_TOKEN;
  process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
  const repoRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "worker-session-")));
  const app: http.Server = createAiSystemServer({
    defaultCwd: repoRoot,
    authToken: SERVER_TOKEN,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async () => ({ ok: true } as any)
  });
  try {
    await fn(await listen(app), repoRoot);
  } finally {
    await closeServer(app);
    await removeTempDir(repoRoot);
    for (const [key, value] of [["ORCHESTRA_WORKER_TOKEN", previous.worker], ["ORCHESTRA_EXECUTION_BACKEND", previous.backend]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function asWorker(sessionToken?: string): Record<string, string> {
  return sessionToken
    ? { Authorization: `Bearer ${WORKER_TOKEN}`, "X-Orchestra-Worker-Session": sessionToken }
    : { Authorization: `Bearer ${WORKER_TOKEN}` };
}

async function register(baseUrl: string, name: string, repoRoot: string) {
  const { worker } = await requestJson(baseUrl, "POST", "/workers", { name, os: "linux", workspaceRoots: [repoRoot] }, 201, asWorker());
  assert.ok(worker.sessionToken, "registration hands the worker its session token");
  return worker as { id: string; sessionToken: string };
}

test("a worker token alone cannot act as a worker", async () => {
  await withWorkerServer(async (baseUrl, repoRoot) => {
    const alice = await register(baseUrl, "alice", repoRoot);
    const bob = await register(baseUrl, "bob", repoRoot);

    await requestJson(baseUrl, "POST", `/workers/${bob.id}/heartbeat`, { status: "idle" }, 401, asWorker());
    // Holding the shared token and a session is not enough: it has to be bob's.
    await requestJson(baseUrl, "POST", `/workers/${bob.id}/heartbeat`, { status: "idle" }, 401, asWorker(alice.sessionToken));
    await requestJson(baseUrl, "POST", `/workers/${bob.id}/jobs/claim`, {}, 401, asWorker(alice.sessionToken));
    await requestJson(baseUrl, "POST", `/workers/${bob.id}/heartbeat`, { status: "idle" }, 200, asWorker(bob.sessionToken));
  });
});

test("a lease can only be used by the worker that holds it", async () => {
  await withWorkerServer(async (baseUrl, repoRoot) => {
    const alice = await register(baseUrl, "alice", repoRoot);
    const bob = await register(baseUrl, "bob", repoRoot);
    const created = await requestJson(baseUrl, "POST", "/jobs", { task: "leased", cwd: repoRoot, dryRun: true }, 202, server);
    const claim = await requestJson(baseUrl, "POST", `/workers/${alice.id}/jobs/claim`, {}, 200, asWorker(alice.sessionToken));
    assert.equal(claim.job.jobId, created.jobId);
    const leaseId = claim.lease.leaseId;

    // Bob, authenticated as himself, presents alice's lease id.
    const stolen = await requestJson(baseUrl, "POST", `/jobs/${created.jobId}/complete`, { workerId: bob.id, leaseId }, 400, asWorker(bob.sessionToken));
    assert.equal(stolen.error, "Lease belongs to another worker");
    // Bob claiming to be alice is stopped by the session check.
    await requestJson(baseUrl, "POST", `/jobs/${created.jobId}/complete`, { workerId: alice.id, leaseId }, 401, asWorker(bob.sessionToken));

    await requestJson(baseUrl, "POST", `/jobs/${created.jobId}/start`, { workerId: alice.id, leaseId }, 200, asWorker(alice.sessionToken));
    await requestJson(baseUrl, "POST", `/jobs/${created.jobId}/complete`, { workerId: alice.id, leaseId, artifactPath: "/etc" }, 200, asWorker(alice.sessionToken));

    const job = await waitForJobStatus(baseUrl, String(created.jobId), "completed", { headers: server });
    // The read endpoints root themselves at artifactPath, so one outside the
    // worker's workspace is dropped rather than trusted.
    assert.equal(job.artifactPath, null);
  });
});

test("a worker abandons a job the moment it is cancelled", async () => {
  await withWorkerServer(async (baseUrl, repoRoot) => {
    const created = await requestJson(baseUrl, "POST", "/jobs", { task: "long job", cwd: repoRoot, dryRun: true }, 202, server);
    let sawAbort = false;
    let reachedExecutor: () => void = () => {};
    const executing = new Promise<void>((resolve) => {
      reachedExecutor = resolve;
    });

    const runtime = runWorkerRuntime(
      loadWorkerRuntimeConfig({
        cwd: repoRoot,
        serverUrl: baseUrl,
        workerToken: WORKER_TOKEN,
        workerName: "cancellable",
        workspaceRoots: [repoRoot],
        provider: "dummy",
        once: true,
        heartbeatIntervalMs: 50,
        pollIntervalMs: 50
      }),
      {
        logger: silentLogger(),
        executor: async ({ signal }) => {
          reachedExecutor();
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 15_000);
            signal?.addEventListener("abort", () => {
              sawAbort = true;
              clearTimeout(timer);
              resolve();
            });
          });
          return { ok: true, summary: "finished anyway", logs: [], filesystemMutated: false };
        }
      }
    );

    await executing;
    await requestJson(baseUrl, "POST", `/jobs/${created.jobId}/cancel`, {}, 200, server);
    const summary = await runtime;

    assert.equal(sawAbort, true, "the provider run was stopped, not left to finish");
    assert.equal(summary.completedJobs, 0);
    const job = await requestJson(baseUrl, "GET", `/jobs/${created.jobId}`, undefined, 200, server);
    assert.equal(job.status, "cancelled");
  });
});
