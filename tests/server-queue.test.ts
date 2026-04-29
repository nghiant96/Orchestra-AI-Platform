import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer, mapRunSummaryToQueueJob, resolveQueueRunApprovalMode } from "../ai-system/server-app.js";
import type { Logger, OrchestratorResult } from "../ai-system/types.js";

test("server jobs API enqueues, completes, lists, and returns stable JSON", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-jobs-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const created = await requestJson(baseUrl, "POST", "/jobs", { task: "do queued work", dryRun: true });
    assert.equal(created.status, "queued");
    assert.equal(typeof created.jobId, "string");

    const completed = await waitForJob(baseUrl, String(created.jobId), "completed");
    assert.equal(completed.task, "do queued work");
    assert.equal(completed.cwd, repoRoot);
    assert.equal(completed.artifactPath, path.join(repoRoot, ".ai-system-artifacts", "mock-run"));

    const listed = await requestJson(baseUrl, "GET", "/jobs");
    assert.equal(Array.isArray(listed.jobs), true);
    assert.equal(listed.jobs.some((job: any) => job.jobId === created.jobId), true);
  } finally {
    await closeServer(server);
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("server keeps POST /run synchronous and rejects disallowed job cwd", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-run-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-outside-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const runResult = await requestJson(baseUrl, "POST", "/run", { task: "sync run", dryRun: true });
    assert.equal(runResult.ok, true);
    assert.equal(runResult.repoRoot, repoRoot);

    const rejected = await requestJson(baseUrl, "POST", "/jobs", { task: "bad cwd", cwd: outsideRoot }, 403);
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /outside AI_SYSTEM_ALLOWED_WORKDIRS/);
  } finally {
    await closeServer(server);
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  }
});

test("server cancels queued jobs", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-cancel-"));
  let releaseFirstJob: () => void = () => {};
  const releaseFirstJobSignal = new Promise<void>((resolve) => {
    releaseFirstJob = resolve;
  });
  let runCount = 0;
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    queueConcurrency: 1,
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => {
      runCount += 1;
      if (runCount === 1) {
        await releaseFirstJobSignal;
      }
      return createResult({ task, cwd, dryRun, ok: true });
    }
  });

  try {
    const baseUrl = await listen(server);
    const first = await requestJson(baseUrl, "POST", "/jobs", { task: "hold worker" });
    const queued = await requestJson(baseUrl, "POST", "/jobs", { task: "cancel me" });
    const cancelled = await requestJson(baseUrl, "POST", `/jobs/${queued.jobId}/cancel`);
    assert.equal(cancelled.status, "cancelled");
    releaseFirstJob();
    await waitForJob(baseUrl, String(queued.jobId), "cancelled");
    await waitForJob(baseUrl, String(first.jobId), "completed");
  } finally {
    releaseFirstJob();
    await closeServer(server);
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("queue approval mode follows skip_approval config", () => {
  assert.deepEqual(resolveQueueRunApprovalMode({ skip_approval: true } as any), {
    interactive: false,
    pauseAfterPlan: false
  });
  assert.deepEqual(resolveQueueRunApprovalMode({ skip_approval: false } as any), {
    interactive: true,
    pauseAfterPlan: true
  });
  assert.deepEqual(resolveQueueRunApprovalMode({} as any), {
    interactive: true,
    pauseAfterPlan: true
  });
});

test("health and queued jobs expose effective approval mode", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-approval-mode-"));
  await fs.writeFile(path.join(repoRoot, ".ai-system.json"), JSON.stringify({ skip_approval: true }), "utf8");
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const health = await requestJson(baseUrl, "GET", "/health");
    assert.equal(health.queue.approvalMode, "auto");
    assert.equal(health.queue.skipApproval, true);

    const created = await requestJson(baseUrl, "POST", "/jobs", { task: "auto approval mode" });
    assert.equal(created.approvalMode, "auto");
  } finally {
    await closeServer(server);
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("artifact run summaries map to typed queue jobs", () => {
  const retryHint = { stage: "iteration-tools", iteration: 2, reason: "lint failed" };
  const baseRun = {
    runName: "run-1",
    status: "completed",
    task: "done",
    dryRun: false,
    updatedAt: "2026-04-29T00:00:00.000Z",
    runPath: "/tmp/run-1",
    diffSummaries: [],
    latestToolResults: [],
    execution: {
      totalDurationMs: 10,
      steps: [],
      transitions: [],
      currentStage: null,
      terminalStage: null,
      failure: null,
      retryHint,
      providerMetrics: [],
      budget: null
    }
  } as any;

  const mapped = mapRunSummaryToQueueJob(baseRun, "/repo");
  assert.equal(mapped.status, "completed");
  assert.deepEqual(mapped.execution?.retryHint, retryHint);
  assert.equal(mapRunSummaryToQueueJob({ ...baseRun, status: "failed" }, "/repo").status, "failed");
  assert.equal(mapRunSummaryToQueueJob({ ...baseRun, status: "paused_after_plan" }, "/repo").status, "waiting_for_approval");
  assert.equal(mapRunSummaryToQueueJob({ ...baseRun, status: "unexpected" }, "/repo").status, "failed");
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function requestJson(
  baseUrl: string,
  method: string,
  pathname: string,
  body?: unknown,
  expectedStatus?: number
): Promise<any> {
  const url = new URL(pathname, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          try {
            assert.equal(res.statusCode, expectedStatus ?? (method === "POST" && pathname === "/jobs" ? 202 : 200));
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function waitForJob(baseUrl: string, jobId: string, status: string): Promise<any> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await requestJson(baseUrl, "GET", `/jobs/${jobId}`);
    if (job.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
}

function createResult({
  task,
  cwd,
  dryRun,
  ok
}: {
  task: string;
  cwd: string;
  dryRun: boolean;
  ok: boolean;
}): OrchestratorResult {
  return {
    ok,
    status: ok ? "completed" : "failed",
    dryRun,
    repoRoot: cwd,
    configPath: null,
    plan: {
      prompt: task,
      readFiles: [],
      writeTargets: [],
      notes: []
    },
    result: {
      summary: `Finished ${task}`,
      files: []
    },
    iterations: [],
    issueCounts: {},
    skippedContextFiles: [],
    finalIssues: [],
    providers: {
      planner: "test",
      reviewer: "test",
      generator: "test",
      fixer: "test"
    },
    memory: {
      backend: "test",
      planningMatches: 0,
      implementationMatches: 0,
      stored: false
    },
    artifacts: {
      enabled: true,
      ok: true,
      runPath: path.join(cwd, ".ai-system-artifacts", "mock-run"),
      latestIterationPath: null,
      stepPaths: {},
      latestFiles: []
    },
    wroteFiles: false
  };
}

function silentLogger(): Logger {
  return {
    step() {},
    info() {},
    warn() {},
    error() {},
    success() {}
  };
}
