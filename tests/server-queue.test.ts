import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer, mapRunSummaryToQueueJob, resolveQueueRunApprovalMode } from "../ai-system/server-app.js";
import type { OrchestratorResult } from "../ai-system/types.js";
import { listen, closeServer, silentLogger, requestJson } from "./test-utils.js";

test("server jobs API enqueues, completes, lists, and returns stable JSON", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-jobs-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const created = await requestJson(baseUrl, "POST", "/jobs", { task: "do queued work", dryRun: true }, 202);
    assert.equal(created.status, "queued");
    assert.equal(typeof created.jobId, "string");

    const completed = await waitForJob(baseUrl, String(created.jobId), "completed");
    assert.equal(completed.task, "do queued work");
    assert.equal(completed.cwd, repoRoot);
    assert.equal(completed.artifactPath, path.join(repoRoot, ".ai-system-artifacts", "mock-run"));

    const listed = await requestJson(baseUrl, "GET", "/jobs");
    assert.equal(Array.isArray(listed.jobs), true);
    assert.equal(
      listed.jobs.some((job: any) => job.jobId === created.jobId),
      true
    );
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
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
    await cleanupDir(repoRoot);
    await cleanupDir(outsideRoot);
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
    const first = await requestJson(baseUrl, "POST", "/jobs", { task: "hold worker" }, 202);
    const queued = await requestJson(baseUrl, "POST", "/jobs", { task: "cancel me" }, 202);
    const cancelled = await requestJson(baseUrl, "POST", `/jobs/${queued.jobId}/cancel`);
    assert.equal(cancelled.status, "cancelled");
    releaseFirstJob();
    await waitForJob(baseUrl, String(queued.jobId), "cancelled");
    await waitForJob(baseUrl, String(first.jobId), "completed");
  } finally {
    releaseFirstJob();
    await closeServer(server);
    await cleanupDir(repoRoot);
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

    const created = await requestJson(baseUrl, "POST", "/jobs", { task: "auto approval mode" }, 202);
    assert.equal(created.approvalMode, "auto");
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
  }
});

test("server mode requires auth for health and protected routes", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-auth-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    authToken: "test-token",
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const unauthorized = await requestJson(baseUrl, "GET", "/health", undefined, 401);
    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.error, "Unauthorized");

    const authorized = await requestJson(baseUrl, "GET", "/health", undefined, 200, {
      Authorization: "Bearer test-token"
    });
    assert.equal(authorized.ok, true);
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
  }
});

test("project registry and audit log expose multi-project operations", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-registry-"));
  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-registry-other-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot, otherRoot],
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const projects = await requestJson(baseUrl, "GET", "/projects");
    assert.equal(projects.ok, true);
    assert.equal(projects.projects.length, 2);
    assert.ok(projects.projects.some((project: any) => project.cwd === repoRoot && project.queueDir.includes(".ai-system-server")));

    const denied = await requestJson(baseUrl, "POST", "/jobs", { task: "viewer should not enqueue" }, 403, {
      "x-ai-system-role": "viewer"
    });
    assert.equal(denied.error, "Operator role required");

    const created = await requestJson(baseUrl, "POST", "/jobs", { task: "audited job", dryRun: true }, 202, {
      "x-ai-system-role": "operator",
      "x-ai-system-actor": "tester"
    });
    await waitForJob(baseUrl, String(created.jobId), "completed");

    const audit = await requestJson(baseUrl, "GET", "/audit");
    assert.ok(audit.events.some((event: any) => event.action === "job.create" && event.actor.id === "tester"));
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
    await cleanupDir(otherRoot);
  }
});

test("project permissions gate sensitive actions and audit can be exported", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-permissions-"));
  await fs.writeFile(path.join(repoRoot, ".ai-system.json"), JSON.stringify({
    auth: {
      role_mapping: { viewer: "viewer", operator: "operator", admin: "admin" },
      project_role_mapping: {
        [path.basename(repoRoot)]: { viewer: "viewer", operator: "operator", admin: "admin" }
      },
      action_permissions: {
        "queue.pause": "operator",
        "queue.resume": "operator",
        "queue.clear_finished": "operator",
        "config.update": "admin",
        "work_item.create": "operator"
      }
    }
  }), "utf8");
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const denied = await requestJson(baseUrl, "POST", "/queue/pause", undefined, 403, {
      "x-ai-system-actor": "viewer",
      "x-ai-system-role": "viewer"
    });
    assert.equal(denied.ok, false);

    const allowed = await requestJson(baseUrl, "POST", "/queue/pause", undefined, 200, {
      "x-ai-system-actor": "operator",
      "x-ai-system-role": "operator"
    });
    assert.equal(allowed.paused, true);

    const exportResult = await requestJson(baseUrl, "GET", "/audit/export?format=json");
    assert.equal(exportResult.ok, true);
    assert.ok(Array.isArray(exportResult.events));
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
  }
});

test("server smoke covers health projects jobs stats lessons and audit", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-smoke-"));
  await fs.writeFile(path.join(repoRoot, ".ai-system.json"), JSON.stringify({ skip_approval: true }), "utf8");
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const encodedCwd = encodeURIComponent(repoRoot);

    const health = await requestJson(baseUrl, "GET", "/health");
    assert.equal(health.ok, true);
    assert.equal(health.cwd, repoRoot);

    const projects = await requestJson(baseUrl, "GET", "/projects");
    assert.equal(projects.ok, true);
    assert.ok(projects.projects.some((project: any) => project.cwd === repoRoot));

    const created = await requestJson(
      baseUrl,
      "POST",
      "/jobs",
      { task: "smoke dry-run job", cwd: repoRoot, dryRun: true },
      undefined,
      {
        "x-ai-system-role": "operator",
        "x-ai-system-actor": "smoke"
      }
    );
    assert.equal(created.approvalMode, "auto");
    await waitForJob(baseUrl, String(created.jobId), "completed");

    const jobs = await requestJson(baseUrl, "GET", `/jobs?cwd=${encodedCwd}`);
    assert.ok(jobs.jobs.some((job: any) => job.jobId === created.jobId));

    const stats = await requestJson(baseUrl, "GET", `/stats?cwd=${encodedCwd}`);
    assert.equal(stats.ok, true);
    assert.ok(Array.isArray(stats.costByDay));
    assert.ok(Array.isArray(stats.failuresByClass));
    assert.ok(Array.isArray(stats.providerPerformance));
    assert.equal(typeof stats.queueLatency.avgWaitTimeMs, "number");
    assert.equal(typeof stats.queueLatency.avgExecutionTimeMs, "number");
    assert.equal(stats.queueLatency.totalQueueRecords >= 1, true);

    const lessonsBefore = await requestJson(baseUrl, "GET", `/lessons?cwd=${encodedCwd}`);
    assert.equal(lessonsBefore.ok, true);
    assert.ok(Array.isArray(lessonsBefore.lessons));

    await requestJson(
      baseUrl,
      "POST",
      "/lessons",
      { cwd: repoRoot, title: "Smoke lesson", body: "Smoke tests must cover operator-visible server workflows." },
      201,
      {
        "x-ai-system-role": "operator",
        "x-ai-system-actor": "smoke"
      }
    );
    const lessonsAfter = await requestJson(baseUrl, "GET", `/lessons?cwd=${encodedCwd}`);
    assert.ok(lessonsAfter.lessons.some((lesson: any) => lesson.title === "Smoke lesson"));

    const audit = await requestJson(baseUrl, "GET", "/audit");
    assert.ok(audit.events.some((event: any) => event.action === "job.create" && event.actor.id === "smoke"));
    assert.ok(audit.events.some((event: any) => event.action === "lesson.create" && event.actor.id === "smoke"));
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
  }
});

test("jobs API filters queue records by requested project cwd", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-project-a-"));
  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-project-b-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot, otherRoot],
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const first = await requestJson(baseUrl, "POST", "/jobs", { task: "project a" }, 202);
    const second = await requestJson(baseUrl, "POST", "/jobs", { task: "project b", cwd: otherRoot }, 202);
    await waitForJob(baseUrl, String(first.jobId), "completed");
    await waitForJob(baseUrl, String(second.jobId), "completed");

    const projectA = await requestJson(baseUrl, "GET", `/jobs?cwd=${encodeURIComponent(repoRoot)}`);
    assert.deepEqual(
      projectA.jobs.map((job: any) => job.cwd),
      [repoRoot]
    );

    const projectB = await requestJson(baseUrl, "GET", `/jobs?cwd=${encodeURIComponent(otherRoot)}`);
    assert.deepEqual(
      projectB.jobs.map((job: any) => job.cwd),
      [otherRoot]
    );

    const rejected = await requestJson(baseUrl, "GET", `/jobs?cwd=${encodeURIComponent(path.dirname(repoRoot))}`, undefined, 403);
    assert.equal(rejected.ok, false);
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
    await cleanupDir(otherRoot);
  }
});

test("jobs API accepts a GitHub URL directly as task input", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-server-external-task-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult({ task, cwd, dryRun, ok: true })
  });

  try {
    const baseUrl = await listen(server);
    const created = await requestJson(baseUrl, "POST", "/jobs", {
      task: "https://github.com/owner/repo/pull/456"
    }, 202);

    assert.equal(created.externalTask.kind, "pull_request");
    assert.equal(created.externalTask.number, 456);
    assert.match(created.task, /staff-level review/);
    assert.equal(created.workflowMode, "review");
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
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

async function waitForJob(baseUrl: string, jobId: string, status: string): Promise<any> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await requestJsonMaybe(baseUrl, "GET", `/jobs/${jobId}`);
    if (job?.status === status) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
}

async function requestJsonMaybe(
  baseUrl: string,
  method: string,
  pathname: string,
  body?: unknown
): Promise<any | null> {
  const url = new URL(pathname, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
              }
            : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          try {
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

function createResult({ task, cwd, dryRun, ok }: { task: string; cwd: string; dryRun: boolean; ok: boolean }): OrchestratorResult {
  return {
    version: 1,
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

async function cleanupDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
