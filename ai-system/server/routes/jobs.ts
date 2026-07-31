import type http from "node:http";
import { roleCan } from "../../core/audit-log.js";
import { canPerformAction } from "../../core/permissions.js";
import {
  createSyncRun,
  createJob,
  listJobs,
  getJob,
  cancelJob,
  approveJob,
  getJobFileContent,
  getJobArtifactContent,
  parseWorkflowMode,
  normalizeApprovalProof,
  JobServiceError
} from "../../jobs/job-service.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";
import { readJsonBody } from "../read-json-body.js";

export const jobsRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/run" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const task = typeof payload?.task === "string" ? payload.task.trim() : "";
      if (!task) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing task" });
        return true;
      }
      const cwd = await ctx.resolveRequestedCwd(payload?.cwd, ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules,
        runNow: ctx.runNow
      };
      const result = await createSyncRun(serviceCtx, {
        task,
        cwd,
        dryRun: payload?.dryRun !== false,
        workflowMode: parseWorkflowMode(payload?.workflowMode) ?? "standard",
        workflowProfile: payload?.workflowProfile
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
      if (!task && !externalUrl) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing task" });
        return true;
      }
      const cwd = await ctx.resolveRequestedCwd(payload?.cwd, ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      try {
        const job = await createJob(serviceCtx, {
          task,
          cwd,
          dryRun: payload?.dryRun !== false,
          workflowMode: payload?.workflowMode,
          workflowProfile: payload?.workflowProfile,
          externalUrl: externalUrl || undefined
        });
        ctx.respondJson(res, 202, job);
        return true;
      } catch (err) {
        if (err instanceof JobServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    if (url.pathname === "/jobs" && req.method === "GET") {
      const filterCwd = await ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!filterCwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      const result = await listJobs(serviceCtx, filterCwd);
      ctx.respondJson(res, 200, result);
      return true;
    }

    const jobMatch = /^\/jobs\/([^/]+)$/.exec(url.pathname);
    if (jobMatch && req.method === "GET") {
      const jobId = jobMatch[1] ?? "";
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      const job = await getJob(serviceCtx, jobId);
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
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      const job = await cancelJob(serviceCtx, jobId);
      if (!job) {
        ctx.respondJson(res, 404, { ok: false, error: "Job not found" });
        return true;
      }
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
      const action = approvalMatch[2] as "approve" | "reject";
      const payload = await readJsonBody(req);
      const proof = normalizeApprovalProof(payload?.approvalProof ?? payload);
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      try {
        const result = await approveJob(serviceCtx, jobId, action, ctx.pendingApprovals, { proof });
        if (!result) {
          ctx.respondJson(res, 404, { ok: false, error: "Pending approval not found" });
          return true;
        }
        ctx.respondJson(res, 200, result);
        return true;
      } catch (err) {
        if (err instanceof JobServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    const contentMatch = /^\/jobs\/([^/]+)\/files\/content$/.exec(url.pathname);
    if (contentMatch && req.method === "GET") {
      const jobId = contentMatch[1] ?? "";
      const filePath = url.searchParams.get("path");
      const type = url.searchParams.get("type") || "generated";
      const requestedCwd = await ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!requestedCwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      if (!filePath) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing path parameter" });
        return true;
      }
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      const result = await getJobFileContent(serviceCtx, jobId, filePath, type, requestedCwd);
      ctx.respondJson(res, result.ok ? 200 : result.statusCode ?? 404, result);
      return true;
    }

    const artifactContentMatch = /^\/jobs\/([^/]+)\/artifacts\/content$/.exec(url.pathname);
    if (artifactContentMatch && req.method === "GET") {
      const jobId = artifactContentMatch[1] ?? "";
      const artifactName = url.searchParams.get("name");
      if (!artifactName) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing name parameter" });
        return true;
      }
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      const result = await getJobArtifactContent(serviceCtx, jobId, artifactName);
      ctx.respondJson(res, result.ok ? 200 : result.statusCode ?? 404, result);
      return true;
    }

    const manifestMatch = /^\/jobs\/([^/]+)\/manifest$/.exec(url.pathname);
    if (manifestMatch && req.method === "GET") {
      const jobId = manifestMatch[1] ?? "";
      const serviceCtx = {
        queue: ctx.queue,
        auditLog: ctx.auditLog,
        actor: ctx.actor,
        rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules
      };
      const result = await getJobArtifactContent(serviceCtx, jobId, "manifest.json");
      if (!result.ok || !result.content) {
        ctx.respondJson(res, result.statusCode ?? 404, result);
        return true;
      }
      try {
        ctx.respondJson(res, 200, { ok: true, manifest: JSON.parse(result.content) });
      } catch {
        ctx.respondJson(res, 500, { ok: false, error: "Manifest is not valid JSON" });
      }
      return true;
    }

    return false;
  }
};
