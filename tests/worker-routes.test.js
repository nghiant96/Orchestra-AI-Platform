import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson } from "./test-utils.js";
describe("Worker Routes", () => {
    let tmpDir;
    let baseUrl;
    let server;
    before(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-routes-test-"));
        server = createAiSystemServer({
            defaultCwd: tmpDir,
            logger: silentLogger(),
            runner: async () => ({ ok: true }),
            allowedWorkdirs: [tmpDir]
        });
        baseUrl = await listen(server);
    });
    after(async () => {
        await closeServer(server);
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
    test("POST /workers/register creates a worker", async () => {
        const result = await requestJson(baseUrl, "POST", "/workers", {
            name: "test-worker",
            version: "0.1.0",
            os: "darwin",
            arch: "arm64",
            labels: ["macbook", "ios"],
            capabilities: { xcode: true, node: true },
            workspaceRoots: [tmpDir]
        }, 201);
        assert.equal(result.ok, true);
        assert.ok(result.worker.id.startsWith("worker-"));
        assert.equal(result.worker.name, "test-worker");
        assert.equal(result.worker.os, "darwin");
        assert.equal(result.worker.status, "online");
        assert.ok(result.worker.sessionToken);
        assert.deepEqual(result.worker.workspaceRoots, [await fs.realpath(tmpDir)]);
    });
    test("POST /workers/register rejects symlink workspace roots outside allowed roots", { skip: process.platform === "win32" }, async () => {
        const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worker-routes-outside-"));
        const linkedRoot = path.join(tmpDir, "linked-outside-root");
        await fs.symlink(outsideRoot, linkedRoot);
        try {
            const result = await requestJson(baseUrl, "POST", "/workers", {
                name: "symlink-escape-worker",
                os: "linux",
                workspaceRoots: [linkedRoot]
            }, 403);
            assert.equal(result.ok, false);
            assert.match(String(result.error || ""), /Workspace root not in allowed workdirs/);
        }
        finally {
            await fs.rm(linkedRoot, { force: true });
            await fs.rm(outsideRoot, { recursive: true, force: true });
        }
    });
    test("POST /workers/register rejects empty name", async () => {
        const result = await requestJson(baseUrl, "POST", "/workers", {
            name: ""
        }, 400);
        assert.equal(result.ok, false);
        assert.ok(result.error);
    });
    test("POST /workers/:id/heartbeat updates worker", async () => {
        const created = await requestJson(baseUrl, "POST", "/workers", {
            name: "heartbeat-test",
            os: "linux",
            workspaceRoots: [tmpDir]
        }, 201);
        const workerId = created.worker.id;
        const result = await requestJson(baseUrl, "POST", `/workers/${workerId}/heartbeat`, {
            status: "busy",
            currentJobId: "job-123",
            freeDiskGb: 250,
            cpuLoad: 0.45
        }, 200);
        assert.equal(result.ok, true);
        assert.equal(result.worker.status, "busy");
        assert.equal(result.worker.currentJobId, "job-123");
        assert.equal(result.worker.freeDiskGb, 250);
        assert.equal(result.worker.cpuLoad, 0.45);
        assert.equal(result.worker.sessionToken, undefined);
    });
    test("POST /workers/:id/heartbeat rejects invalid status", async () => {
        const created = await requestJson(baseUrl, "POST", "/workers", {
            name: "heartbeat-invalid-status",
            os: "linux",
            workspaceRoots: [tmpDir]
        }, 201);
        const workerId = created.worker.id;
        const result = await requestJson(baseUrl, "POST", `/workers/${workerId}/heartbeat`, {
            status: "mystery"
        }, 400);
        assert.equal(result.ok, false);
        assert.match(String(result.error || ""), /Invalid worker status/);
        const detail = await requestJson(baseUrl, "GET", `/workers/${workerId}`, undefined, 200);
        assert.equal(detail.worker.status, "online");
        assert.equal(detail.worker.sessionToken, undefined);
    });
    test("POST /workers/:id/heartbeat returns 404 for unknown worker", async () => {
        const result = await requestJson(baseUrl, "POST", "/workers/worker-unknown/heartbeat", {
            status: "idle"
        }, 404);
        assert.equal(result.ok, false);
    });
    test("POST /workers/:id/disable requires operator", async () => {
        const created = await requestJson(baseUrl, "POST", "/workers", {
            name: "disable-test",
            os: "linux",
            workspaceRoots: [tmpDir]
        }, 201);
        const workerId = created.worker.id;
        const result = await requestJson(baseUrl, "POST", `/workers/${workerId}/disable`, {}, 200);
        assert.equal(result.ok, true);
        assert.equal(result.worker.status, "disabled");
    });
    test("POST /workers/:id/enable restores worker", async () => {
        const created = await requestJson(baseUrl, "POST", "/workers", {
            name: "enable-test",
            os: "linux",
            workspaceRoots: [tmpDir]
        }, 201);
        const workerId = created.worker.id;
        await requestJson(baseUrl, "POST", `/workers/${workerId}/disable`, {}, 200);
        const result = await requestJson(baseUrl, "POST", `/workers/${workerId}/enable`, {}, 200);
        assert.equal(result.ok, true);
        assert.equal(result.worker.status, "idle");
    });
    test("POST /workers/:id/drain sets draining", async () => {
        const created = await requestJson(baseUrl, "POST", "/workers", {
            name: "drain-test",
            os: "linux",
            workspaceRoots: [tmpDir]
        }, 201);
        const workerId = created.worker.id;
        const result = await requestJson(baseUrl, "POST", `/workers/${workerId}/drain`, {}, 200);
        assert.equal(result.ok, true);
        assert.equal(result.worker.status, "draining");
    });
    test("GET /workers lists all workers", async () => {
        await requestJson(baseUrl, "POST", "/workers", {
            name: "list-test-1",
            os: "linux",
            workspaceRoots: [tmpDir]
        }, 201);
        await requestJson(baseUrl, "POST", "/workers", {
            name: "list-test-2",
            os: "darwin",
            workspaceRoots: [tmpDir]
        }, 201);
        const result = await requestJson(baseUrl, "GET", "/workers", undefined, 200);
        assert.equal(result.ok, true);
        assert.ok(result.workers.length >= 2);
        assert.equal(result.workers[0]?.sessionToken, undefined);
    });
    test("GET /workers/:id returns worker detail", async () => {
        const created = await requestJson(baseUrl, "POST", "/workers", {
            name: "detail-test",
            os: "linux",
            workspaceRoots: [tmpDir]
        }, 201);
        const result = await requestJson(baseUrl, "GET", `/workers/${created.worker.id}`, undefined, 200);
        assert.equal(result.ok, true);
        assert.equal(result.worker.name, "detail-test");
        assert.equal(result.worker.sessionToken, undefined);
    });
    test("GET /workers/:id returns 404 for unknown", async () => {
        const result = await requestJson(baseUrl, "GET", "/workers/worker-nonexistent", undefined, 404);
        assert.equal(result.ok, false);
    });
    test("Existing /jobs API still works", async () => {
        const created = await requestJson(baseUrl, "POST", "/jobs", {
            task: "worker coexistence test",
            dryRun: true,
            cwd: tmpDir
        }, 202, {
            "x-ai-system-role": "operator",
            "x-ai-system-actor": "dashboard"
        });
        await waitForJob(baseUrl, String(created.jobId), "completed");
        const jobs = await requestJson(baseUrl, "GET", "/jobs", undefined, 200, {
            "x-ai-system-role": "operator",
            "x-ai-system-actor": "dashboard"
        });
        assert.ok(jobs.jobs.length > 0);
    });
});
async function waitForJob(baseUrl, jobId, status) {
    for (let i = 0; i < 20; i++) {
        const job = await requestJson(baseUrl, "GET", `/jobs/${jobId}`, undefined, 200);
        if (job.status === status) {
            return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Job ${jobId} did not reach ${status}`);
}
