import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir } from "./test-utils.js";

/**
 * Several workers doing different jobs at the same time, in one repository.
 *
 * The existing claim contract proves two workers cannot take the *same* job.
 * This proves the complementary half — that they can take *different* ones
 * concurrently — which is the property the multi-agent story rests on and the
 * one nothing covered.
 */
describe("Parallel worker throughput", () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  let previousBackend: string | undefined;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-parallel-"));
    previousBackend = process.env.ORCHESTRA_EXECUTION_BACKEND;
    process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
    server = createAiSystemServer({
      defaultCwd: tmpDir,
      logger: silentLogger(),
      allowedWorkdirs: [tmpDir],
      runner: async () => ({ ok: true }) as any
    });
    baseUrl = await listen(server);
  });

  after(async () => {
    await closeServer(server);
    if (previousBackend === undefined) {
      delete process.env.ORCHESTRA_EXECUTION_BACKEND;
    } else {
      process.env.ORCHESTRA_EXECUTION_BACKEND = previousBackend;
    }
    await removeTempDir(tmpDir);
  });

  test("three workers claim three distinct jobs from one repository at once", async () => {
    const jobs = await Promise.all(
      ["alpha", "beta", "gamma"].map((name) =>
        requestJson(baseUrl, "POST", "/jobs", { task: `parallel ${name}`, cwd: tmpDir, dryRun: true }, 202)
      )
    );
    const queuedIds = new Set(jobs.map((job) => job.jobId));
    assert.equal(queuedIds.size, 3);

    const workers = await Promise.all(
      ["w1", "w2", "w3"].map((name) =>
        requestJson(baseUrl, "POST", "/workers", { name, os: process.platform, workspaceRoots: [tmpDir] }, 201)
      )
    );

    // All three claim in the same tick — the interesting case, because the
    // per-record lock and the shared listing are both under contention.
    const claims = await Promise.all(
      workers.map((registration) =>
        requestJson(baseUrl, "POST", `/workers/${registration.worker.id}/jobs/claim`, {}, 200)
      )
    );

    const claimedIds = claims.map((claim) => claim.job?.jobId).filter(Boolean) as string[];
    assert.equal(claimedIds.length, 3, `every worker should get work, got ${JSON.stringify(claims.map((c) => c.rejectionReason))}`);
    assert.equal(new Set(claimedIds).size, 3, "no job may be handed to two workers");
    for (const jobId of claimedIds) {
      assert.ok(queuedIds.has(jobId), `claimed job ${jobId} should be one of the queued jobs`);
    }

    // Each claim must carry its own lease, owned by the worker that took it.
    const leaseIds = claims.map((claim) => claim.lease?.leaseId).filter(Boolean);
    assert.equal(new Set(leaseIds).size, 3, "each claim needs a distinct lease");
    for (const [index, claim] of claims.entries()) {
      assert.equal(claim.lease.workerId, workers[index]!.worker.id);
    }
  });

  test("a fourth worker finds nothing left rather than stealing an active lease", async () => {
    const extra = await requestJson(
      baseUrl,
      "POST",
      "/workers",
      { name: "w4", os: process.platform, workspaceRoots: [tmpDir] },
      201
    );
    const claim = await requestJson(baseUrl, "POST", `/workers/${extra.worker.id}/jobs/claim`, {}, 200);
    assert.equal(claim.job, null, "leased jobs must not be re-claimable");
  });

  test("workers run concurrently rather than one after another", async () => {
    // Two jobs, two workers, each held busy for a beat. If claiming and running
    // were serialised the wall clock would be the sum; concurrency makes it the
    // max. A generous margin keeps this from becoming a performance assertion.
    const holdMs = 400;
    const created = await Promise.all(
      ["one", "two"].map((name) =>
        requestJson(baseUrl, "POST", "/jobs", { task: `concurrent ${name}`, cwd: tmpDir, dryRun: true }, 202)
      )
    );

    const registrations = await Promise.all(
      ["p1", "p2"].map((name) =>
        requestJson(baseUrl, "POST", "/workers", { name, os: process.platform, workspaceRoots: [tmpDir] }, 201)
      )
    );

    const startedAt = Date.now();
    const results = await Promise.all(
      registrations.map(async (registration) => {
        const workerId = registration.worker.id;
        const claim = await requestJson(baseUrl, "POST", `/workers/${workerId}/jobs/claim`, {}, 200);
        if (!claim.job) return null;
        await requestJson(baseUrl, "POST", `/jobs/${claim.job.jobId}/start`, {
          workerId,
          leaseId: claim.lease.leaseId
        }, 200);
        await new Promise((resolve) => setTimeout(resolve, holdMs));
        await requestJson(baseUrl, "POST", `/jobs/${claim.job.jobId}/complete`, {
          workerId,
          leaseId: claim.lease.leaseId,
          resultSummary: "done"
        }, 200);
        return claim.job.jobId;
      })
    );
    const elapsed = Date.now() - startedAt;

    const completedIds = results.filter(Boolean) as string[];
    assert.equal(completedIds.length, 2, "both workers should have had a job");
    assert.equal(new Set(completedIds).size, 2);
    assert.ok(
      elapsed < holdMs * 2,
      `expected overlapping execution, but ${elapsed}ms >= ${holdMs * 2}ms suggests the workers ran in sequence`
    );

    for (const jobId of created.map((job) => job.jobId)) {
      const job = await requestJson(baseUrl, "GET", `/jobs/${jobId}`, undefined, 200);
      assert.equal(job.status, "completed", `job ${jobId} should have completed`);
    }
  });
});
