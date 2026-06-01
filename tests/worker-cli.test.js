import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { parseArgs } from "../ai-system/cli/arg-parser.js";
import { loadWorkerRuntimeConfig } from "../ai-system/worker/worker-config.js";
import { runWorkerRuntime } from "../ai-system/worker/worker-runtime.js";
import { listen, closeServer, silentLogger, requestJson } from "./test-utils.js";
describe("Phase 2 worker CLI", () => {
    test("parseArgs accepts worker start flags", async () => {
        const origIsTTY = process.stdin.isTTY;
        process.stdin.isTTY = true;
        try {
            const options = await parseArgs([
                "worker",
                "start",
                "--server-url",
                "http://127.0.0.1:3927",
                "--token",
                "worker-token",
                "--name",
                "test-worker",
                "--labels",
                "mac,ios",
                "--workspace-roots",
                "/tmp/a,/tmp/b",
                "--heartbeat-interval",
                "2500",
                "--poll-interval",
                "500",
                "--once"
            ]);
            assert.deepEqual(options.command, {
                kind: "worker-start",
                serverUrl: "http://127.0.0.1:3927",
                workerToken: "worker-token",
                workerName: "test-worker",
                workerLabels: ["mac", "ios"],
                workspaceRoots: ["/tmp/a", "/tmp/b"],
                heartbeatIntervalMs: 2500,
                pollIntervalMs: 500,
                once: true
            });
        }
        finally {
            process.stdin.isTTY = origIsTTY;
        }
    });
    test("worker registers, claims, uploads redacted logs, and completes dummy jobs", async () => {
        const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worker-cli-runtime-"));
        const previousBackend = process.env.ORCHESTRA_EXECUTION_BACKEND;
        const previousWorkerToken = process.env.ORCHESTRA_WORKER_TOKEN;
        process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
        process.env.ORCHESTRA_WORKER_TOKEN = "worker-token";
        const server = createAiSystemServer({
            defaultCwd: repoRoot,
            authToken: "server-token",
            allowedWorkdirs: [repoRoot],
            logger: silentLogger(),
            runner: async ({ task, cwd }) => createResult(task, cwd)
        });
        try {
            const baseUrl = await listen(server);
            const operatorHeaders = {
                Authorization: "Bearer server-token",
                "x-ai-system-role": "operator",
                "x-ai-system-actor": "worker-cli-test"
            };
            const created = await requestJson(baseUrl, "POST", "/jobs", { task: "dummy job with secret sk-test12345678901234567890", cwd: repoRoot, dryRun: true }, 202, operatorHeaders);
            const summary = await runWorkerRuntime(loadWorkerRuntimeConfig({
                cwd: repoRoot,
                serverUrl: baseUrl,
                workerToken: "worker-token",
                workerName: "test-worker",
                workspaceRoots: [repoRoot],
                once: true,
                heartbeatIntervalMs: 100,
                pollIntervalMs: 100
            }), { logger: silentLogger() });
            assert.equal(summary.claimedJobs, 1);
            assert.equal(summary.completedJobs, 1);
            assert.equal(summary.failedJobs, 0);
            assert.ok(summary.uploadedLogLines > 0);
            const job = await waitForJob(baseUrl, String(created.jobId), "completed", { Authorization: "Bearer server-token" });
            assert.equal(job.status, "completed");
            assert.ok(Array.isArray(job.workerLogs));
            const workerLogs = job.workerLogs.join("\n");
            assert.match(workerLogs, /dummy job/);
            assert.ok(!workerLogs.includes("sk-test12345678901234567890"));
        }
        finally {
            process.env.ORCHESTRA_EXECUTION_BACKEND = previousBackend;
            process.env.ORCHESTRA_WORKER_TOKEN = previousWorkerToken;
            await closeServer(server);
            await fs.rm(repoRoot, { recursive: true, force: true });
        }
    });
    test("worker sends mutation checkpoint before writing a file", async () => {
        const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worker-cli-mutation-"));
        const previousBackend = process.env.ORCHESTRA_EXECUTION_BACKEND;
        const previousWorkerToken = process.env.ORCHESTRA_WORKER_TOKEN;
        process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
        process.env.ORCHESTRA_WORKER_TOKEN = "worker-token";
        const server = createAiSystemServer({
            defaultCwd: repoRoot,
            authToken: "server-token",
            allowedWorkdirs: [repoRoot],
            logger: silentLogger(),
            runner: async ({ task, cwd }) => createResult(task, cwd)
        });
        try {
            const baseUrl = await listen(server);
            const operatorHeaders = {
                Authorization: "Bearer server-token",
                "x-ai-system-role": "operator",
                "x-ai-system-actor": "worker-cli-test"
            };
            const created = await requestJson(baseUrl, "POST", "/jobs", { task: "worker:write-file output.txt::content with sk-test12345678901234567890", cwd: repoRoot, dryRun: false }, 202, operatorHeaders);
            const summary = await runWorkerRuntime(loadWorkerRuntimeConfig({
                cwd: repoRoot,
                serverUrl: baseUrl,
                workerToken: "worker-token",
                workerName: "mutation-worker",
                workspaceRoots: [repoRoot],
                once: true,
                heartbeatIntervalMs: 100,
                pollIntervalMs: 100
            }), { logger: silentLogger() });
            assert.equal(summary.claimedJobs, 1);
            const job = await waitForJob(baseUrl, String(created.jobId), "completed", { Authorization: "Bearer server-token" });
            assert.equal(job.status, "completed");
            assert.equal(job.mutationCheckpoint?.filesystemMutated, true);
            assert.ok(await fs.stat(path.join(repoRoot, "output.txt")).then(() => true));
            assert.ok(Array.isArray(job.workerLogs));
            const checkpointIndex = job.workerLogs.findIndex((line) => line.includes("checkpointing filesystem mutation"));
            const writeIndex = job.workerLogs.findIndex((line) => line.includes("writing output.txt"));
            assert.ok(checkpointIndex >= 0);
            assert.ok(writeIndex >= 0);
            assert.ok(checkpointIndex < writeIndex);
        }
        finally {
            process.env.ORCHESTRA_EXECUTION_BACKEND = previousBackend;
            process.env.ORCHESTRA_WORKER_TOKEN = previousWorkerToken;
            await closeServer(server);
            await fs.rm(repoRoot, { recursive: true, force: true });
        }
    });
    test("worker dry-run never mutates files or records mutation checkpoint", async () => {
        const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worker-cli-dry-run-"));
        const previousBackend = process.env.ORCHESTRA_EXECUTION_BACKEND;
        const previousWorkerToken = process.env.ORCHESTRA_WORKER_TOKEN;
        process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
        process.env.ORCHESTRA_WORKER_TOKEN = "worker-token";
        const server = createAiSystemServer({
            defaultCwd: repoRoot,
            authToken: "server-token",
            allowedWorkdirs: [repoRoot],
            logger: silentLogger(),
            runner: async ({ task, cwd }) => createResult(task, cwd)
        });
        try {
            const baseUrl = await listen(server);
            const operatorHeaders = {
                Authorization: "Bearer server-token",
                "x-ai-system-role": "operator",
                "x-ai-system-actor": "worker-cli-test"
            };
            const created = await requestJson(baseUrl, "POST", "/jobs", { task: "worker:write-file dry-run-output.txt::must not be written", cwd: repoRoot, dryRun: true }, 202, operatorHeaders);
            const summary = await runWorkerRuntime(loadWorkerRuntimeConfig({
                cwd: repoRoot,
                serverUrl: baseUrl,
                workerToken: "worker-token",
                workerName: "dry-run-worker",
                workspaceRoots: [repoRoot],
                once: true,
                heartbeatIntervalMs: 100,
                pollIntervalMs: 100
            }), { logger: silentLogger() });
            assert.equal(summary.claimedJobs, 1);
            const job = await waitForJob(baseUrl, String(created.jobId), "completed", { Authorization: "Bearer server-token" });
            assert.equal(job.status, "completed");
            assert.equal(job.mutationCheckpoint, undefined);
            await assert.rejects(() => fs.stat(path.join(repoRoot, "dry-run-output.txt")), /ENOENT/);
            assert.match(job.resultSummary, /Dry-run skipped write/);
        }
        finally {
            process.env.ORCHESTRA_EXECUTION_BACKEND = previousBackend;
            process.env.ORCHESTRA_WORKER_TOKEN = previousWorkerToken;
            await closeServer(server);
            await fs.rm(repoRoot, { recursive: true, force: true });
        }
    });
});
function createResult(task, cwd) {
    return {
        version: 1,
        ok: true,
        status: "completed",
        dryRun: false,
        repoRoot: cwd,
        configPath: null,
        plan: { prompt: task, readFiles: [], writeTargets: [], notes: [] },
        result: { summary: "done", files: [], tools: [], errors: [] },
        iterations: [],
        issueCounts: {},
        skippedContextFiles: [],
        finalIssues: [],
        providers: { planner: "test", reviewer: "test", generator: "test", fixer: "test" },
        memory: { backend: "test", planningMatches: 0, implementationMatches: 0, stored: false },
        artifacts: { enabled: true, ok: true, runPath: path.join(cwd, ".ai-system-artifacts", "mock"), latestIterationPath: null, stepPaths: {}, latestFiles: [] },
        wroteFiles: false,
        execution: { currentStage: null, terminalStage: null, steps: [], transitions: [], failure: null, retryHint: null, providerMetrics: [], budget: null, totalDurationMs: 10 }
    };
}
async function waitForJob(baseUrl, jobId, status, headers) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const job = await requestJson(baseUrl, "GET", `/jobs/${jobId}`, undefined, 200, headers);
        if (job.status === status) {
            return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
}
