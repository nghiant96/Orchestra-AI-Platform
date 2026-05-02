import type http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { roleCan } from "../../core/audit-log.js";
import { parseExternalTask, normalizeExternalTaskToPrompt } from "../../core/external-task.js";
import { listRecentRunSummaries } from "../../core/artifacts.js";
import { classifyServerError } from "../../core/server-analytics.js";
import { loadJsonIfExists } from "../../utils/config.js";
import { resolveApprovalPolicy } from "../../core/risk-policy.js";
import { canPerformAction } from "../../core/permissions.js";
import type { QueueJob } from "../../core/job-queue.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";
import type { WorkflowMode } from "../../core/workflow-modes.js";

export const jobsRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/run" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const task = typeof payload?.task === "string" ? payload.task.trim() : "";
      if (!task) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing task" });
        return true;
      }
      const cwd = ctx.resolveRequestedCwd(payload?.cwd, ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const result = await ctx.runNow({
        jobId: `sync-${Date.now().toString(36)}`,
        task,
        cwd,
        dryRun: payload?.dryRun !== false,
        workflowMode: parseWorkflowMode(payload?.workflowMode) ?? "standard"
      });
      ctx.respondJson(res, 200, result);
      return true;
    }

    if (url.pathname === "/jobs" && req.method === "POST") {
      if (!roleCan(ctx.actor, "operator") || !canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "work_item.create")) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      const payload = await readJsonBody(req);
      const task = typeof payload?.task === "string" ? payload.task.trim() : "";
      const externalUrl = typeof payload?.externalUrl === "string" ? payload.externalUrl : "";
      let effectiveTask = task;
      let externalTask;
      let effectiveWorkflowMode = parseWorkflowMode(payload?.workflowMode) ?? "standard";
      if (externalUrl || task) {
        const parsed = parseExternalTask(externalUrl || task);
        if (parsed) {
          externalTask = parsed;
          if (!effectiveTask || effectiveTask === parsed.url) effectiveTask = normalizeExternalTaskToPrompt(parsed);
          if (parsed.kind === "pull_request" && !payload?.workflowMode) effectiveWorkflowMode = "review";
        } else if (externalUrl) {
          ctx.respondJson(res, 400, { ok: false, error: "Invalid external task URL" });
          return true;
        }
      }
      if (!effectiveTask) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing task" });
        return true;
      }
      const cwd = ctx.resolveRequestedCwd(payload?.cwd, ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const { rules } = await loadRules(cwd);
      const approvalMode = resolveApprovalPolicy(effectiveTask, rules, [], { workflowMode: effectiveWorkflowMode as WorkflowMode });
      const job = await ctx.queue.enqueue({
        task: effectiveTask,
        cwd,
        dryRun: payload?.dryRun !== false,
        workflowMode: effectiveWorkflowMode,
        approvalMode: approvalMode?.approvalMode ?? "manual",
        approvalPolicy: approvalMode ?? undefined,
        externalTask
      });
      await ctx.auditLog.append({ actor: ctx.actor, action: "job.create", cwd, jobId: job.jobId, details: { dryRun: job.dryRun, approvalMode: job.approvalMode, riskClass: job.approvalPolicy?.riskClass ?? null } });
      ctx.respondJson(res, 202, job);
      return true;
    }

    if (url.pathname === "/jobs" && req.method === "GET") {
      const filterCwd = ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!filterCwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const jobs = await ctx.queue.list();
      const filteredQueueJobs = jobs.filter((j) => isPathWithinRoot(filterCwd, j.cwd));
      try {
        const { rules } = await loadRules(filterCwd);
        const recentRuns = await listRecentRunSummaries(filterCwd, rules, 20);
        const runJobs: QueueJob[] = recentRuns
          .filter((run) => !jobs.some((j) => j.artifactPath === run.runPath || j.jobId === run.runName))
          .map((run) => mapRunSummaryToQueueJob(run, filterCwd));
        const merged = [...filteredQueueJobs, ...runJobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        ctx.respondJson(res, 200, { version: 1, jobs: merged.slice(0, 50) });
        return true;
      } catch {
        ctx.respondJson(res, 200, { version: 1, jobs: filteredQueueJobs });
        return true;
      }
    }

    const jobMatch = /^\/jobs\/([^/]+)$/.exec(url.pathname);
    if (jobMatch && req.method === "GET") {
      const jobId = jobMatch[1] ?? "";
      const job = await ctx.queue.get(jobId);
      if (!job) {
        ctx.respondJson(res, 404, { ok: false, error: "Job not found" });
        return true;
      }
      ctx.respondJson(res, 200, job);
      return true;
    }

    const cancelMatch = /^\/jobs\/([^/]+)\/cancel$/.exec(url.pathname);
    if (cancelMatch && req.method === "POST") {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "queue.pause")) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      const jobId = cancelMatch[1] ?? "";
      const job = await ctx.queue.cancel(jobId);
      if (!job) {
        ctx.respondJson(res, 404, { ok: false, error: "Job not found" });
        return true;
      }
      await ctx.auditLog.append({ actor: ctx.actor, action: "job.cancel", cwd: job.cwd, jobId: job.jobId });
      ctx.respondJson(res, 200, job);
      return true;
    }

    const approvalMatch = /^\/jobs\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
    if (approvalMatch && req.method === "POST") {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "queue.resume")) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      const jobId = approvalMatch[1] ?? "";
      const action = approvalMatch[2] ?? "";
      const pendingApproval = ctx.pendingApprovals.get(jobId);
      const job = await ctx.queue.get(jobId);
      if (!pendingApproval || !job) {
        ctx.respondJson(res, 404, { ok: false, error: "Pending approval not found" });
        return true;
      }
      ctx.pendingApprovals.delete(jobId);
      pendingApproval.resolve(action === "approve");
      await ctx.auditLog.append({ actor: ctx.actor, action: `job.${action}`, cwd: job.cwd, jobId });
      ctx.respondJson(res, 200, { ok: true, jobId, approved: action === "approve" });
      return true;
    }

    const contentMatch = /^\/jobs\/([^/]+)\/files\/content$/.exec(url.pathname);
    if (contentMatch && req.method === "GET") {
      const jobId = contentMatch[1] ?? "";
      const filePath = url.searchParams.get("path");
      const type = url.searchParams.get("type") || "generated";
      const requestedCwd = ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!requestedCwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      if (!filePath) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing path parameter" });
        return true;
      }
      const job = await ctx.queue.get(jobId);
      let artifactPath = job?.artifactPath;
      if (!artifactPath && jobId.startsWith("run-")) {
        const { rules } = await loadRules(requestedCwd);
        const artifactsDir = path.resolve(requestedCwd, rules.artifacts?.data_dir || ".ai-system-artifacts");
        artifactPath = path.join(artifactsDir, jobId);
      }
      if (!artifactPath) {
        ctx.respondJson(res, 404, { ok: false, error: "Job not found or no artifacts" });
        return true;
      }
      try {
        const index = await loadJsonIfExists<any>(path.join(artifactPath, "artifact-index.json"));
        const latestIterationPath = index?.latestIterationPath;
        if (!latestIterationPath) {
          ctx.respondJson(res, 404, { ok: false, error: "No iteration data found" });
          return true;
        }
        const iterationDir = path.isAbsolute(latestIterationPath) ? latestIterationPath : path.join(artifactPath, latestIterationPath);
        const subDir = type === "original" ? "files-original" : "files";
        const fullPath = path.join(iterationDir, subDir, filePath);
        try {
          const content = await fs.readFile(fullPath, "utf8");
          ctx.respondJson(res, 200, { ok: true, content });
          return true;
        } catch {
          ctx.respondJson(res, 404, { ok: false, error: "File not found in artifacts" });
          return true;
        }
      } catch (err) {
        ctx.respondJson(res, 500, { ok: false, error: (err as Error).message });
        return true;
      }
    }

    return false;
  }
};

function parseWorkflowMode(value: unknown): WorkflowMode | null {
  return value === "standard" || value === "implement" || value === "review" || value === "fix" || value === "refactor" ? value : null;
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function mapRunSummaryToQueueJob(run: Awaited<ReturnType<typeof listRecentRunSummaries>>[number], defaultCwd: string): QueueJob {
  return {
    version: 1,
    jobId: run.runName,
    status: run.status === "completed" || run.status === "resumed_completed" ? "completed" : run.status === "failed" ? "failed" : "cancelled",
    task: run.task,
    cwd: defaultCwd,
    dryRun: run.dryRun,
    createdAt: run.updatedAt || new Date().toISOString(),
    updatedAt: run.updatedAt || new Date().toISOString(),
    artifactPath: run.runPath,
    resultSummary: run.execution?.failure?.reason || run.status,
    failure: run.status === "failed" ? classifyServerError(run.execution?.failure?.reason) : undefined,
    diffSummaries: run.diffSummaries,
    latestToolResults: run.latestToolResults,
    execution: run.execution
      ? { transitions: run.execution.transitions, providerMetrics: run.execution.providerMetrics, budget: run.execution.budget, totalDurationMs: run.execution.totalDurationMs, retryHint: run.execution.retryHint ?? null }
      : undefined
  };
}

async function loadRules(cwd: string) {
  const { loadRules } = await import("../../core/orchestrator-runtime.js");
  return loadRules(cwd);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
