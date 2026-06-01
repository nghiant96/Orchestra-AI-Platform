import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson } from "./test-utils.js";

describe("Lease Expiry, Mutation Checkpoints, And Stall Policy", () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-stale-lease-"));
    process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
    server = createAiSystemServer({
      defaultCwd: tmpDir,
      logger: silentLogger(),
      runner: async ({ task, cwd }) => ({
        version: 1, ok: true, status: "completed", dryRun: false, repoRoot: cwd, configPath: null,
        plan: { prompt: task, readFiles: [], writeTargets: [], notes: [] },
        result: { summary: "done", files: [], tools: [], errors: [] } as any,
        iterations: [], issueCounts: {}, skippedContextFiles: [], finalIssues: [],
        providers: {} as any, memory: {} as any,
        artifacts: { enabled: true, ok: true, runPath: path.join(cwd, ".mock"), latestIterationPath: null, stepPaths: {}, latestFiles: [] },
        wroteFiles: false,
        execution: { currentStage: null, terminalStage: null, steps: [], transitions: [], failure: null, retryHint: null, providerMetrics: [], budget: null, totalDurationMs: 10 }
      }),
      allowedWorkdirs: [tmpDir]
    });
    baseUrl = await listen(server);
  });

  after(async () => {
    await closeServer(server);
    delete process.env.ORCHESTRA_EXECUTION_BACKEND;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function registerWorker(name: string, workspaceRoots: string[] = [tmpDir]) {
    return requestJson(baseUrl, "POST", "/workers", { name, os: "linux", workspaceRoots }, 201);
  }

  async function enqueueJob(task: string, cwd: string = tmpDir) {
    return requestJson(baseUrl, "POST", "/jobs", { task, cwd, dryRun: true }, 202);
  }

  test("heartbeat renews active lease", async () => {
    const { worker } = await registerWorker("renew-worker");
    await enqueueJob("renew test");
    const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
    assert.ok(claimed.lease);

    const result = await requestJson(baseUrl, "POST", `/workers/${worker.id}/heartbeat`, {
      status: "busy",
      currentJobId: claimed.job.jobId,
      leaseId: claimed.lease.leaseId,
      jobId: claimed.job.jobId
    }, 200);

    assert.equal(result.ok, true);
  });

  test("checkpoint saves mutation stage", async () => {
    const { worker } = await registerWorker("checkpoint-worker");
    await enqueueJob("checkpoint test");
    const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);

    const result = await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/checkpoint`, {
      workerId: worker.id,
      leaseId: claimed.lease.leaseId,
      stage: "apply_patch",
      filesystemMutated: true,
      worktreePath: "/tmp/test"
    }, 200);

    assert.equal(result.ok, true);
  });

  test("checkpoint rejects invalid leaseId", async () => {
    const { worker } = await registerWorker("cp-invalid-worker");
    const { jobId } = await enqueueJob("cp invalid test");

    const result = await requestJson(baseUrl, "POST", `/jobs/${jobId}/checkpoint`, {
      workerId: worker.id,
      leaseId: "lease-nonexistent",
      stage: "apply_patch",
      filesystemMutated: false
    }, 400);

    assert.equal(result.ok, false);
  });

  test("stale pre-mutation lease: job can be re-queued via direct store", async () => {
    const root = path.join(tmpDir, "pre-mut");
    await fs.mkdir(root, { recursive: true });
    const { worker } = await registerWorker("pre-mut-worker", [root]);
    const { worker: rescuer } = await registerWorker("pre-mut-rescuer", [root]);
    await enqueueJob("pre-mut test", root);

    const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
    assert.ok(claimed.job);

    await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/checkpoint`, {
      workerId: worker.id,
      leaseId: claimed.lease.leaseId,
      stage: "collect_context",
      filesystemMutated: false
    }, 200);

    // Force lease expiry
    const jobsDir = path.join(tmpDir, ".ai-system-server", "jobs");
    const jobFile = path.join(jobsDir, `${claimed.job.jobId}.json`);
    const raw = JSON.parse(await fs.readFile(jobFile, "utf8"));
    raw.lease.expiresAt = new Date(Date.now() - 60000).toISOString();
    raw.status = "running";
    await fs.writeFile(jobFile, JSON.stringify(raw, null, 2), "utf8");

    const reclaimed = await requestJson(baseUrl, "POST", `/workers/${rescuer.id}/jobs/claim`, {}, 200);
    assert.ok(reclaimed.job);
    assert.equal(reclaimed.job.jobId, claimed.job.jobId);
    assert.equal(reclaimed.job.status, "assigned");

    const verify = JSON.parse(await fs.readFile(jobFile, "utf8"));
    assert.equal(verify.mutationCheckpoint, undefined);
    assert.equal(verify.status, "assigned");
  });

  test("stale post-mutation lease: job becomes stalled via detectStaleLeases", async () => {
    const root = path.join(tmpDir, "post-mut");
    await fs.mkdir(root, { recursive: true });
    const { worker } = await registerWorker("post-mut-worker", [root]);
    const { worker: rescuer } = await registerWorker("post-mut-rescuer", [root]);
    await enqueueJob("post-mut test", root);

    const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
    assert.ok(claimed.job);

    await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/checkpoint`, {
      workerId: worker.id,
      leaseId: claimed.lease.leaseId,
      stage: "apply_patch",
      filesystemMutated: true,
      worktreePath: "/tmp/worktree"
    }, 200);

    // Force lease expiry
    const jobsDir = path.join(tmpDir, ".ai-system-server", "jobs");
    const jobFile = path.join(jobsDir, `${claimed.job.jobId}.json`);
    const raw = JSON.parse(await fs.readFile(jobFile, "utf8"));
    raw.lease.expiresAt = new Date(Date.now() - 60000).toISOString();
    raw.status = "running";
    await fs.writeFile(jobFile, JSON.stringify(raw, null, 2), "utf8");

    const reclaimed = await requestJson(baseUrl, "POST", `/workers/${rescuer.id}/jobs/claim`, {}, 200);
    assert.equal(reclaimed.job, null);

    const verify = JSON.parse(await fs.readFile(jobFile, "utf8"));
    assert.equal(verify.mutationCheckpoint.filesystemMutated, true);
    assert.equal(verify.status, "stalled");
    assert.ok(verify.lease);
  });

  test("recover stalled job returns it to queued", async () => {
    const { worker } = await registerWorker("recover-worker");
    await enqueueJob("recover test");

    const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
    assert.ok(claimed.job);

    await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/checkpoint`, {
      workerId: worker.id,
      leaseId: claimed.lease.leaseId,
      stage: "apply_patch",
      filesystemMutated: true
    }, 200);

    // Make it stalled directly
    const jobsDir = path.join(tmpDir, ".ai-system-server", "jobs");
    const jobFile = path.join(jobsDir, `${claimed.job.jobId}.json`);
    const raw = JSON.parse(await fs.readFile(jobFile, "utf8"));
    raw.status = "stalled";
    raw.lease = undefined;
    await fs.writeFile(jobFile, JSON.stringify(raw, null, 2), "utf8");

    const result = await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/recover`, {}, 200);
    assert.equal(result.ok, true);

    const verify = JSON.parse(await fs.readFile(jobFile, "utf8"));
    assert.equal(verify.status, "queued");
  });

  test("recover rejects non-stalled job", async () => {
    const { jobId } = await enqueueJob("not stalled");

    const result = await requestJson(baseUrl, "POST", `/jobs/${jobId}/recover`, {}, 400);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  test("complete/fail rejects expired lease", async () => {
    const { worker } = await registerWorker("expired-lease-worker");
    await enqueueJob("expired lease test");

    const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
    assert.ok(claimed.job);

    const jobsDir = path.join(tmpDir, ".ai-system-server", "jobs");
    const jobFile = path.join(jobsDir, `${claimed.job.jobId}.json`);
    const raw = JSON.parse(await fs.readFile(jobFile, "utf8"));
    raw.lease.expiresAt = new Date(Date.now() - 60000).toISOString();
    await fs.writeFile(jobFile, JSON.stringify(raw, null, 2), "utf8");

    const result = await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/complete`, {
      workerId: worker.id,
      leaseId: claimed.lease.leaseId
    }, 400);

    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  test("existing APIs still work after stale lease handling", async () => {
    const jobs = await requestJson(baseUrl, "GET", "/jobs", {}, 200);
    assert.ok(Array.isArray(jobs.jobs));

    const workItems = await requestJson(baseUrl, "GET", "/work-items", { cwd: tmpDir }, 200);
    assert.ok(Array.isArray(workItems.workItems));

    const health = await requestJson(baseUrl, "GET", "/health", {}, 200);
    assert.equal(health.ok, true);
  });
});
