import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson } from "./test-utils.js";
function createResult({ task, cwd, ok }) {
    return {
        version: 1,
        ok,
        status: ok ? "completed" : "failed",
        dryRun: false,
        repoRoot: cwd,
        configPath: null,
        plan: { prompt: task, readFiles: [], writeTargets: [], notes: [] },
        result: { summary: ok ? "done" : "failed", files: [], tools: [], errors: [] },
        iterations: [],
        issueCounts: {},
        skippedContextFiles: [],
        finalIssues: [],
        providers: {},
        memory: {},
        artifacts: { enabled: true, ok: true, runPath: path.join(cwd, ".ai-system-artifacts", "mock"), latestIterationPath: null, stepPaths: {}, latestFiles: [] },
        wroteFiles: false,
        execution: { currentStage: null, terminalStage: null, steps: [], transitions: [], failure: null, retryHint: null, providerMetrics: [], budget: null, totalDurationMs: 10 }
    };
}
describe("Worker Claim And Lease", () => {
    let tmpDir;
    let server;
    let baseUrl;
    before(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-claim-test-"));
        process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
        const allowedWorkdirs = [tmpDir, path.resolve(tmpDir, "project-a"), path.resolve(tmpDir, "project-b")];
        server = createAiSystemServer({
            defaultCwd: tmpDir,
            logger: silentLogger(),
            runner: async ({ task, cwd }) => createResult({ task, cwd, ok: true }),
            allowedWorkdirs
        });
        baseUrl = await listen(server);
        await fs.mkdir(path.join(tmpDir, "project-a"), { recursive: true });
        await fs.mkdir(path.join(tmpDir, "project-b"), { recursive: true });
    });
    after(async () => {
        await closeServer(server);
        delete process.env.ORCHESTRA_EXECUTION_BACKEND;
        await cleanupDir(tmpDir);
    });
    async function registerWorker(name, workspaceRoots) {
        return requestJson(baseUrl, "POST", "/workers", {
            name,
            os: "linux",
            workspaceRoots
        }, 201);
    }
    async function enqueueJob(task, cwd) {
        return requestJson(baseUrl, "POST", "/jobs", { task, cwd, dryRun: true }, 202);
    }
    test("claim returns null when no jobs are queued", async () => {
        const { worker } = await registerWorker("idle-worker", [tmpDir]);
        const result = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        assert.equal(result.ok, true);
        assert.equal(result.job, null);
        assert.ok(result.rejectionReason);
    });
    test("claim returns a job when one is queued", async () => {
        const { worker } = await registerWorker("claim-worker", [tmpDir]);
        const { jobId } = await enqueueJob("test task", tmpDir);
        const result = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        assert.equal(result.ok, true);
        assert.ok(result.job, "Should return a job");
        assert.equal(result.job.jobId, jobId);
        assert.equal(result.job.status, "assigned");
        assert.equal(result.job.workerId, worker.id);
        assert.ok(result.lease, "Should return a lease");
        assert.equal(result.lease.workerId, worker.id);
        assert.ok(result.lease.leaseId.startsWith("lease-"));
    });
    test("start requires a valid lease and is idempotent", async () => {
        const { worker } = await registerWorker("start-worker", [tmpDir]);
        const { jobId } = await enqueueJob("start transition", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        const invalid = await requestJson(baseUrl, "POST", `/jobs/${jobId}/start`, {
            workerId: worker.id,
            leaseId: "lease-wrong"
        }, 400);
        assert.equal(invalid.ok, false);
        const started = await requestJson(baseUrl, "POST", `/jobs/${jobId}/start`, {
            workerId: worker.id,
            leaseId: claimed.lease.leaseId
        }, 200);
        assert.equal(started.ok, true);
        const repeated = await requestJson(baseUrl, "POST", `/jobs/${jobId}/start`, {
            workerId: worker.id,
            leaseId: claimed.lease.leaseId
        }, 200);
        assert.equal(repeated.ok, true);
        const job = await requestJson(baseUrl, "GET", `/jobs/${jobId}`, undefined, 200);
        assert.equal(job.status, "running");
        assert.ok(job.startedAt);
    });
    test("busy heartbeat starts and renews valid leases", async () => {
        const { worker } = await registerWorker("heartbeat-renew-worker", [tmpDir]);
        const { jobId } = await enqueueJob("heartbeat renew", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        const heartbeat = await requestJson(baseUrl, "POST", `/workers/${worker.id}/heartbeat`, {
            status: "busy",
            currentJobId: jobId,
            jobId,
            leaseId: claimed.lease.leaseId
        }, 200);
        assert.equal(heartbeat.ok, true);
        assert.equal(heartbeat.leaseRenewed, true);
        const job = await requestJson(baseUrl, "GET", `/jobs/${jobId}`, undefined, 200);
        assert.equal(job.status, "running");
    });
    test("busy heartbeat rejects invalid lease early", async () => {
        const { worker } = await registerWorker("heartbeat-invalid-worker", [tmpDir]);
        const { jobId } = await enqueueJob("heartbeat invalid", tmpDir);
        await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        const heartbeat = await requestJson(baseUrl, "POST", `/workers/${worker.id}/heartbeat`, {
            status: "busy",
            currentJobId: jobId,
            jobId,
            leaseId: "lease-invalid"
        }, 409);
        assert.equal(heartbeat.ok, false);
        assert.equal(heartbeat.leaseRenewed, false);
        assert.match(String(heartbeat.leaseError || ""), /Invalid leaseId/);
    });
    test("busy heartbeat rejects expired leases", async () => {
        const { worker } = await registerWorker("heartbeat-expired-worker", [tmpDir]);
        const { jobId } = await enqueueJob("heartbeat expired", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        const jobPath = path.join(tmpDir, ".ai-system-server", "jobs", `${jobId}.json`);
        const raw = JSON.parse(await fs.readFile(jobPath, "utf8"));
        raw.lease.expiresAt = new Date(Date.now() - 60_000).toISOString();
        await fs.writeFile(jobPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
        const heartbeat = await requestJson(baseUrl, "POST", `/workers/${worker.id}/heartbeat`, {
            status: "busy",
            currentJobId: jobId,
            jobId,
            leaseId: claimed.lease.leaseId
        }, 409);
        assert.equal(heartbeat.ok, false);
        assert.equal(heartbeat.leaseRenewed, false);
        assert.match(String(heartbeat.leaseError || ""), /Lease expired/);
        const cleanup = JSON.parse(await fs.readFile(jobPath, "utf8"));
        cleanup.status = "failed";
        cleanup.error = "test cleanup";
        cleanup.finishedAt = new Date().toISOString();
        cleanup.lease = undefined;
        cleanup.workerId = undefined;
        await fs.writeFile(jobPath, `${JSON.stringify(cleanup, null, 2)}\n`, "utf8");
    });
    test("claim rejects selector and capability mismatches", async () => {
        const { worker } = await registerWorker("selector-worker", [tmpDir]);
        const { jobId } = await enqueueJob("selector mismatch", tmpDir);
        const jobPath = path.join(tmpDir, ".ai-system-server", "jobs", `${jobId}.json`);
        const raw = JSON.parse(await fs.readFile(jobPath, "utf8"));
        raw.workerSelector = { os: "darwin", labels: ["macbook"] };
        raw.requiredCapabilities = { xcode: true };
        await fs.writeFile(jobPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
        const result = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        assert.equal(result.job, null);
        assert.match(String(result.rejectionReason || ""), /No matching jobs available|active leases/);
    });
    test("only one worker can claim a job — second claim returns null", async () => {
        const w1 = await registerWorker("sequential-1", [tmpDir]);
        const w2 = await registerWorker("sequential-2", [tmpDir]);
        await enqueueJob("sequential race", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${w1.worker.id}/jobs/claim`, {}, 200);
        assert.ok(claimed.job, "First worker should claim the job");
        assert.ok(claimed.lease);
        const second = await requestJson(baseUrl, "POST", `/workers/${w2.worker.id}/jobs/claim`, {}, 200);
        assert.equal(second.job, null, "Second worker should not get the job");
        assert.ok(second.rejectionReason);
    });
    test("concurrent claims resolve to exactly one lease owner", async () => {
        const w1 = await registerWorker("concurrent-1", [tmpDir]);
        const w2 = await registerWorker("concurrent-2", [tmpDir]);
        const { jobId } = await enqueueJob("concurrent race", tmpDir);
        const [r1, r2] = await Promise.all([
            requestJson(baseUrl, "POST", `/workers/${w1.worker.id}/jobs/claim`, {}, 200),
            requestJson(baseUrl, "POST", `/workers/${w2.worker.id}/jobs/claim`, {}, 200)
        ]);
        const successful = [r1, r2].filter((result) => Boolean(result.job));
        assert.equal(successful.length, 1);
        assert.equal(successful[0].job.jobId, jobId);
        assert.ok(successful[0].lease);
    });
    test("claim rejects worker with status disabled", async () => {
        const { worker } = await registerWorker("disabled-worker", [tmpDir]);
        await enqueueJob("test", tmpDir);
        await requestJson(baseUrl, "POST", `/workers/${worker.id}/disable`, {}, 200);
        const result = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        assert.equal(result.job, null);
        assert.match(result.rejectionReason, /disabled|not idle/);
    });
    test("claim rejects worker with status draining", async () => {
        const { worker } = await registerWorker("drain-worker", [tmpDir]);
        await enqueueJob("test", tmpDir);
        await requestJson(baseUrl, "POST", `/workers/${worker.id}/drain`, {}, 200);
        const result = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        assert.equal(result.job, null);
        assert.match(result.rejectionReason, /draining|not idle/);
    });
    test("worker cannot claim a job outside workspace roots", async () => {
        const { worker } = await registerWorker("limited-worker", [path.join(tmpDir, "project-a")]);
        await enqueueJob("outside job", path.join(tmpDir, "project-b"));
        const result = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        assert.equal(result.job, null);
    });
    test("complete requires valid leaseId", async () => {
        const { worker } = await registerWorker("complete-worker", [tmpDir]);
        await enqueueJob("complete test", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        const result = await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/complete`, {
            workerId: worker.id,
            leaseId: claimed.lease.leaseId,
            summary: "Forwarded completion summary",
            artifactPath: path.join(tmpDir, ".artifacts", "worker-result"),
            workerLogs: ["worker completed"]
        }, 200);
        assert.equal(result.ok, true);
        const job = await requestJson(baseUrl, "GET", `/jobs/${claimed.job.jobId}`, undefined, 200);
        assert.equal(job.resultSummary, "Forwarded completion summary");
        assert.equal(job.artifactPath, path.join(tmpDir, ".artifacts", "worker-result"));
        assert.deepEqual(job.workerLogs, ["worker completed"]);
    });
    test("concurrent terminal and checkpoint transitions leave one stable terminal state", async () => {
        const { worker } = await registerWorker("transition-race-worker", [tmpDir]);
        await enqueueJob("transition race", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/start`, {
            workerId: worker.id,
            leaseId: claimed.lease.leaseId
        }, 200);
        const [checkpoint, complete, fail] = await Promise.all([
            requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/checkpoint`, {
                workerId: worker.id,
                leaseId: claimed.lease.leaseId,
                stage: "race",
                filesystemMutated: true
            }, undefined),
            requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/complete`, {
                workerId: worker.id,
                leaseId: claimed.lease.leaseId,
                summary: "race complete"
            }, undefined),
            requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/fail`, {
                workerId: worker.id,
                leaseId: claimed.lease.leaseId,
                message: "race fail"
            }, undefined)
        ].map((promise) => promise.catch((error) => ({ ok: false, error: String(error.message || error) }))));
        assert.ok([checkpoint, complete, fail].some((result) => result.ok === true));
        let job = await requestJson(baseUrl, "GET", `/jobs/${claimed.job.jobId}`, undefined, 200);
        if (job.status === "running") {
            await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/complete`, {
                workerId: worker.id,
                leaseId: claimed.lease.leaseId,
                summary: "race retry complete"
            }, 200);
            job = await requestJson(baseUrl, "GET", `/jobs/${claimed.job.jobId}`, undefined, 200);
        }
        assert.ok(job.status === "completed" || job.status === "failed");
    });
    test("complete rejects stale leaseId", async () => {
        const { worker } = await registerWorker("stale-worker", [tmpDir]);
        const { jobId } = await enqueueJob("stale test", tmpDir);
        const result = await requestJson(baseUrl, "POST", `/jobs/${jobId}/complete`, {
            workerId: worker.id,
            leaseId: "lease-nonexistent"
        }, 400);
        assert.equal(result.ok, false);
        assert.ok(result.error);
    });
    test("repeat complete with same leaseId is idempotent", async () => {
        const { worker } = await registerWorker("idempotent-worker", [tmpDir]);
        await enqueueJob("idempotent test", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        const r1 = await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/complete`, {
            workerId: worker.id,
            leaseId: claimed.lease.leaseId
        }, 200);
        assert.equal(r1.ok, true);
        const r2 = await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/complete`, {
            workerId: worker.id,
            leaseId: claimed.lease.leaseId
        }, 200);
        assert.equal(r2.ok, true);
    });
    test("fail requires valid leaseId", async () => {
        const { worker } = await registerWorker("fail-worker", [tmpDir]);
        await enqueueJob("fail test", tmpDir);
        const claimed = await requestJson(baseUrl, "POST", `/workers/${worker.id}/jobs/claim`, {}, 200);
        const result = await requestJson(baseUrl, "POST", `/jobs/${claimed.job.jobId}/fail`, {
            workerId: worker.id,
            leaseId: claimed.lease.leaseId,
            message: "Test failure",
            resultSummary: "Forwarded failure summary",
            workerLogs: ["worker failed"]
        }, 200);
        assert.equal(result.ok, true);
        const job = await requestJson(baseUrl, "GET", `/jobs/${claimed.job.jobId}`, undefined, 200);
        assert.equal(job.error, "Test failure");
        assert.equal(job.resultSummary, "Forwarded failure summary");
        assert.deepEqual(job.workerLogs, ["worker failed"]);
    });
    test("fail rejects invalid leaseId", async () => {
        const { worker } = await registerWorker("fail-stale-worker", [tmpDir]);
        const { jobId } = await enqueueJob("fail stale test", tmpDir);
        const result = await requestJson(baseUrl, "POST", `/jobs/${jobId}/fail`, {
            workerId: worker.id,
            leaseId: "lease-nonexistent",
            message: "Should fail"
        }, 400);
        assert.equal(result.ok, false);
        assert.ok(result.error);
    });
    test("existing /jobs and /work-items still work", async () => {
        const jobsList = await requestJson(baseUrl, "GET", "/jobs", {}, 200);
        assert.ok(Array.isArray(jobsList.jobs));
        const health = await requestJson(baseUrl, "GET", "/health", {}, 200);
        assert.equal(health.ok, true);
    });
});
async function cleanupDir(dir) {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await fs.rm(dir, { recursive: true, force: true });
            return;
        }
        catch (error) {
            if (error.code !== "ENOTEMPTY" || attempt === 4) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
}
