import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { FileBackedJobQueue } from "../ai-system/core/job-queue.js";
import { FileAuditLog } from "../ai-system/core/audit-log.js";
import { resolveJobQueueDirectory } from "../ai-system/core/job-queue.js";
import { resolveAuditLogPath } from "../ai-system/core/audit-log.js";
import {
  createJob,
  createSyncRun,
  listJobs,
  getJob,
  cancelJob,
  approveJob,
  getJobFileContent,
  getJobArtifactContent,
  parseWorkflowMode,
  isPathWithinRoot,
  mapRunSummaryToQueueJob
} from "../ai-system/jobs/job-service.js";
import type { OrchestratorResult } from "../ai-system/types.js";
import { removeTempDir } from "./test-utils.js";

function createResult({ task, cwd, ok }: { task: string; cwd: string; ok: boolean }): OrchestratorResult {
  return {
    version: 1,
    ok,
    status: ok ? "completed" : "failed",
    dryRun: false,
    repoRoot: cwd,
    configPath: null,
    plan: { prompt: task, readFiles: [], writeTargets: [], notes: [] },
    result: { summary: ok ? "done" : "failed", files: [], tools: [], errors: [] } as any,
    iterations: [],
    issueCounts: {},
    skippedContextFiles: [],
    finalIssues: [],
    providers: {} as any,
    memory: {} as any,
    artifacts: {
      enabled: true,
      ok: true,
      runPath: path.join(cwd, ".ai-system-artifacts", "mock-run"),
      latestIterationPath: null,
      stepPaths: {},
      latestFiles: []
    },
    wroteFiles: false,
    execution: {
      currentStage: null,
      terminalStage: null,
      steps: [],
      transitions: [],
      failure: ok ? null : { class: "internal-error", reason: "test failure" },
      retryHint: null,
      providerMetrics: [],
      budget: null,
      totalDurationMs: 10
    }
  };
}

describe("JobService", () => {
  let tmpDir: string;
  let queue: FileBackedJobQueue;
  let auditLog: FileAuditLog;

  test.before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-service-test-"));
    queue = new FileBackedJobQueue(resolveJobQueueDirectory(tmpDir), async () => createResult({ task: "test", cwd: tmpDir, ok: true }));
    auditLog = new FileAuditLog(resolveAuditLogPath(tmpDir));
  });

  test.after(async () => {
    await queue.stop();
    await removeTempDir(tmpDir);
  });

  const ctx = () => ({
    queue,
    auditLog,
    actor: { id: "test-user", role: "operator" as const },
    rules: {} as any
  });

  test("parseWorkflowMode returns valid modes", () => {
    assert.equal(parseWorkflowMode("standard"), "standard");
    assert.equal(parseWorkflowMode("implement"), "implement");
    assert.equal(parseWorkflowMode("review"), "review");
    assert.equal(parseWorkflowMode("fix"), "fix");
    assert.equal(parseWorkflowMode("refactor"), "refactor");
    assert.equal(parseWorkflowMode("invalid"), null);
    assert.equal(parseWorkflowMode(undefined), null);
  });

  test("isPathWithinRoot validates paths", () => {
    assert.equal(isPathWithinRoot("/tmp/test", "/tmp/test"), true);
    assert.equal(isPathWithinRoot("/tmp/test", "/tmp/test/sub"), true);
    assert.equal(isPathWithinRoot("/tmp/test", "/tmp/other"), false);
  });

  test("createJob creates and returns a queued job", async () => {
    const job = await createJob(ctx(), {
      task: "Fix auth bug",
      cwd: tmpDir,
      dryRun: true
    });
    assert.equal(job.status, "queued");
    assert.equal(job.task, "Fix auth bug");
    assert.equal(job.dryRun, true);
    assert.equal(typeof job.jobId, "string");
    assert.ok(job.jobId.length > 0);
  });

  test("createJob keeps legacy workflowMode fallback for invalid PR payloads", async () => {
    const job = await createJob(ctx(), {
      task: "https://github.com/org/repo/pull/123",
      cwd: tmpDir,
      workflowMode: "bogus" as any
    });
    assert.equal(job.workflowMode, "standard");
  });

  test("createJob rejects missing task", async () => {
    await assert.rejects(
      createJob(ctx(), { task: "", cwd: tmpDir }),
      /Missing task/
    );
  });

  test("getJob retrieves a job", async () => {
    const created = await createJob(ctx(), { task: "get test", cwd: tmpDir });
    const retrieved = await getJob(ctx(), created.jobId);
    assert.ok(retrieved);
    assert.equal(retrieved.jobId, created.jobId);
    assert.equal(retrieved.task, "get test");
  });

  test("getJob returns null for unknown id", async () => {
    const result = await getJob(ctx(), "nonexistent");
    assert.equal(result, null);
  });

  test("listJobs returns jobs", async () => {
    const created = await createJob(ctx(), { task: "list test", cwd: tmpDir });
    const result = await listJobs(ctx(), tmpDir);
    assert.equal(result.version, 1);
    assert.ok(Array.isArray(result.jobs));
    assert.ok(result.jobs.some((j) => j.jobId === created.jobId));
  });

  test("cancelJob cancels a queued job", async () => {
    const created = await createJob(ctx(), { task: "cancel test", cwd: tmpDir });
    const cancelled = await cancelJob(ctx(), created.jobId);
    assert.ok(cancelled);
    assert.equal(cancelled.status, "cancelled");
  });

  test("cancelJob returns null for unknown id", async () => {
    const result = await cancelJob(ctx(), "nonexistent");
    assert.equal(result, null);
  });

  test("approveJob approves a pending job", async () => {
    const jobId = "approve-test-job";
    let resolved = false;
    let resolvedValue = false;
    const pendingApprovals = new Map<string, { resolve(value: boolean): void; type: "plan" | "checkpoint"; data?: unknown }>();
    pendingApprovals.set(jobId, {
      resolve: (value: boolean) => {
        resolved = true;
        resolvedValue = value;
      },
      type: "plan"
    });

    await queue.enqueue({ task: "approve test", cwd: tmpDir, dryRun: true });
    const origGet = queue.get.bind(queue);
    queue.get = async (id: string) => id === jobId ? ({ jobId, status: "waiting_for_approval", cwd: tmpDir, task: "approve test", dryRun: true } as any) : origGet(id);

    const result = await approveJob(ctx(), jobId, "approve", pendingApprovals);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.approved, true);
    assert.equal(pendingApprovals.has(jobId), false);
    assert.equal(resolved, true);
    assert.equal(resolvedValue, true);

    queue.get = origGet;
  });

  test("approveJob returns null for unknown approval", async () => {
    const pendingApprovals = new Map<string, { resolve(value: boolean): void; type: "plan" | "checkpoint" }>();
    const result = await approveJob(ctx(), "nonexistent", "approve", pendingApprovals);
    assert.equal(result, null);
  });

  test("getJobFileContent returns 500 for corrupted artifact metadata", async () => {
    const artifactPath = path.join(tmpDir, ".ai-system-artifacts", "broken-run");
    await fs.mkdir(artifactPath, { recursive: true });
    await fs.writeFile(path.join(artifactPath, "artifact-index.json"), "{", "utf8");

    const jobId = "job-artifact-broken";
    const originalGet = queue.get.bind(queue);
    queue.get = async (id: string) => id === jobId ? ({
      jobId,
      artifactPath,
      cwd: tmpDir
    } as any) : originalGet(id);

    try {
      const result = await getJobFileContent(ctx(), jobId, "output.txt", "generated", tmpDir);
      assert.equal(result.ok, false);
      assert.equal(result.statusCode, 500);
      assert.match(result.error ?? "", /Failed to load config|Unexpected token/);
    } finally {
      queue.get = originalGet;
    }
  });

  test("getJobArtifactContent reads whitelisted worker artifacts only", async () => {
    const artifactPath = path.join(tmpDir, ".ai-system-server", "worker-artifacts", "job-readable-artifact");
    await fs.mkdir(path.join(artifactPath, "context"), { recursive: true });
    await fs.mkdir(path.join(artifactPath, "provider"), { recursive: true });
    await fs.writeFile(path.join(artifactPath, ARTIFACT_PATHS.contextPackMarkdown), "# Context\n", "utf8");
    await fs.writeFile(path.join(artifactPath, ARTIFACT_PATHS.providerStdout), "secret transcript\n", "utf8");

    const jobId = "job-readable-artifact";
    const originalGet = queue.get.bind(queue);
    queue.get = async (id: string) => id === jobId ? ({
      jobId,
      artifactPath,
      cwd: tmpDir
    } as any) : originalGet(id);

    try {
      const readable = await getJobArtifactContent(ctx(), jobId, ARTIFACT_PATHS.contextPackMarkdown);
      assert.equal(readable.ok, true);
      assert.equal(readable.content, "# Context\n");

      const blocked = await getJobArtifactContent(ctx(), jobId, ARTIFACT_PATHS.providerStdout);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.statusCode, 400);
    } finally {
      queue.get = originalGet;
    }
  });

  test("createSyncRun runs synchronously", async () => {
    const c = {
      ...ctx(),
      runNow: async (input: any) => createResult({ task: input.task, cwd: input.cwd, ok: true })
    };
    const result = await createSyncRun(c, { task: "sync test", cwd: tmpDir, dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.status, "completed");
  });

  test("mapRunSummaryToQueueJob maps all statuses", () => {
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
        retryHint: null,
        providerMetrics: [],
        budget: null
      }
    } as any;

    const mapped = mapRunSummaryToQueueJob(baseRun, "/repo");
    assert.equal(mapped.status, "completed");
    assert.equal(
      mapRunSummaryToQueueJob({ ...baseRun, status: "failed" }, "/repo").status,
      "failed"
    );
    assert.equal(
      mapRunSummaryToQueueJob({ ...baseRun, status: "paused_after_plan" }, "/repo").status,
      "waiting_for_approval"
    );
    assert.equal(
      mapRunSummaryToQueueJob({ ...baseRun, status: "paused_after_generate" }, "/repo").status,
      "waiting_for_approval"
    );
    assert.equal(
      mapRunSummaryToQueueJob({ ...baseRun, status: "unexpected" }, "/repo").status,
      "failed"
    );
  });
});
