import type http from "node:http";
import path from "node:path";
import { canPerformAction } from "../../core/permissions.js";
import { WorkEngine } from "../../work/work-engine.js";
import { WorkStore } from "../../work/work-store.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";

export const workItemsRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/work-items" && req.method === "GET") {
      const cwd = ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const { rules } = await loadRules(cwd);
      const store = new WorkStore(cwd, rules);
      ctx.respondJson(res, 200, { ok: true, version: 1, workItems: await store.list() });
      return true;
    }

    if (url.pathname === "/work-items" && req.method === "POST") {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "work_item.create")) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      const payload = await readJsonBody(req);
      const cwd = ctx.resolveRequestedCwd(payload?.cwd, ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const title = typeof payload?.title === "string" ? payload.title.trim() : "";
      if (!title) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing work item title" });
        return true;
      }
      const { rules } = await loadRules(cwd);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.create({
        title,
        projectId: path.basename(cwd),
        description: typeof payload?.description === "string" ? payload.description : "",
        type: normalizeWorkItemType(payload?.type),
        source: normalizeWorkItemSource(payload?.source),
        expectedOutput: normalizeExpectedOutput(payload?.expectedOutput),
        linkedRuns: Array.isArray(payload?.linkedRuns) ? payload.linkedRuns.filter((item: unknown) => typeof item === "string") : []
      } as any);
      await ctx.auditLog.append({ actor: ctx.actor, action: "work_item.create", cwd, details: { workItemId: workItem.id } });
      ctx.respondJson(res, 201, { ok: true, workItem });
      return true;
    }

    const workItemMatch = /^\/work-items\/([^/]+)(?:\/(assess|run|cancel|retry))?$/.exec(url.pathname);
    if (workItemMatch && req.method === "GET" && !workItemMatch[2]) {
      const workItemId = workItemMatch[1] ?? "";
      const cwd = ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const { rules } = await loadRules(cwd);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(workItemId);
      if (workItem) {
        ctx.respondJson(res, 200, { ok: true, workItem });
      } else {
        ctx.respondJson(res, 404, { ok: false, error: "Work item not found" });
      }
      return true;
    }

    if (workItemMatch && req.method === "POST" && workItemMatch[2]) {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, `work_item.${workItemMatch[2]}`)) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      const workItemId = workItemMatch[1] ?? "";
      const action = workItemMatch[2];
      const payload = await readJsonBody(req);
      const cwd = ctx.resolveRequestedCwd(payload?.cwd ?? url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const { rules } = await loadRules(cwd);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(workItemId);
      if (!workItem) {
        ctx.respondJson(res, 404, { ok: false, error: "Work item not found" });
        return true;
      }
      if (action === "assess") {
        const assessed = await new WorkEngine(rules).assess(workItem);
        await store.save(assessed);
        await ctx.auditLog.append({ actor: ctx.actor, action: "work_item.assess", cwd, details: { workItemId } });
        ctx.respondJson(res, 200, { ok: true, workItem: assessed });
        return true;
      }
      if (action === "run") {
        const assessed = workItem.assessment ? workItem : await new WorkEngine(rules).assess(workItem);
        const job = await ctx.queue.enqueue({ task: `${assessed.title}\n\n${assessed.description}`.trim(), cwd, dryRun: payload?.dryRun !== false, workflowMode: assessed.expectedOutput === "pull_request" ? "review" : "standard" });
        const updated = { ...assessed, status: "executing" as const, linkedRuns: Array.from(new Set([...assessed.linkedRuns, job.jobId])), updatedAt: new Date().toISOString() };
        await store.save(updated);
        await ctx.auditLog.append({ actor: ctx.actor, action: "work_item.run", cwd, details: { workItemId, jobId: job.jobId } });
        ctx.respondJson(res, 202, { ok: true, workItem: updated, job });
        return true;
      }
      const updated = { ...workItem, status: action === "cancel" ? "cancelled" as const : "created" as const, updatedAt: new Date().toISOString() };
      await store.save(updated);
      await ctx.auditLog.append({ actor: ctx.actor, action: `work_item.${action}`, cwd, details: { workItemId } });
      ctx.respondJson(res, 200, { ok: true, workItem: updated });
      return true;
    }

    return false;
  }
};

async function loadRules(cwd: string) {
  const { loadRules } = await import("../../core/orchestrator-runtime.js");
  return loadRules(cwd);
}

function normalizeWorkItemType(value: unknown) {
  return value === "bugfix" || value === "feature" || value === "refactor" || value === "test" || value === "docs" || value === "investigation" || value === "review" ? value : "feature";
}
function normalizeWorkItemSource(value: unknown) {
  return value === "manual" || value === "github_issue" || value === "github_pr" || value === "ci_failure" || value === "api" || value === "webhook" ? value : "manual";
}
function normalizeExpectedOutput(value: unknown) {
  return value === "report" || value === "patch" || value === "branch" || value === "pull_request" ? value : "patch";
}
async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
