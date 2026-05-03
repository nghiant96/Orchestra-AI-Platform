import type http from "node:http";
import path from "node:path";
import { canPerformAction } from "../../core/permissions.js";
import { WorkEngine } from "../../work/work-engine.js";
import { WorkStore } from "../../work/work-store.js";
import type { WorkItem } from "../../work/work-item.js";
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
      const engine = new WorkEngine(rules);
      const workItems = await Promise.all((await store.list()).map((item) => reconcileWorkItem(item, engine, ctx)));
      ctx.respondJson(res, 200, { ok: true, version: 1, workItems });
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

    const workItemMatch = /^\/work-items\/([^/]+)(?:\/(assess|run|cancel|retry|handoff))?$/.exec(url.pathname);
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
        const reconciled = await reconcileWorkItem(workItem, new WorkEngine(rules), ctx);
        if (reconciled.updatedAt !== workItem.updatedAt) await store.save(reconciled);
        ctx.respondJson(res, 200, { ok: true, workItem: reconciled });
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
        const engine = new WorkEngine(rules);
        const reconciled = await reconcileWorkItem(workItem, engine, ctx);
        const { workItem: planned, requests } = await engine.createNodeExecutionRequests(reconciled, {
          dryRun: payload?.dryRun !== false,
          nodeId: typeof payload?.nodeId === "string" ? payload.nodeId : undefined
        });
        if (requests.length === 0) {
          const updated = {
            ...planned,
            status: planned.graph?.nodes.some((node) => node.status === "failed") ? "failed" as const : planned.status,
            updatedAt: new Date().toISOString()
          };
          await store.save(updated);
          ctx.respondJson(res, 409, { ok: false, error: "No executable graph node is ready.", workItem: updated });
          return true;
        }
        const jobs = [];
        for (const request of requests) {
          jobs.push(await ctx.queue.enqueue({
            task: request.task,
            cwd,
            dryRun: request.dryRun,
            workflowMode: request.workflowMode
          }));
        }
        const updated = engine.attachQueuedRuns(planned, jobs.map((job, index) => ({ nodeId: requests[index]!.nodeId, runId: job.jobId })));
        await store.save(updated);
        await ctx.auditLog.append({
          actor: ctx.actor,
          action: "work_item.run",
          cwd,
          details: { workItemId, jobIds: jobs.map((job) => job.jobId), nodeIds: requests.map((request) => request.nodeId) }
        });
        ctx.respondJson(res, 202, { ok: true, workItem: updated, job: jobs[0], jobs });
        return true;
      }
      if (action === "handoff") {
        const engine = new WorkEngine(rules);
        const reconciled = await reconcileWorkItem(workItem, engine, ctx);
        const handedOff = await engine.handoffToPR(cwd, reconciled, {
          draft: payload?.draft !== false,
          base: typeof payload?.base === "string" ? payload.base : undefined
        });
        await store.save(handedOff);
        await ctx.auditLog.append({ actor: ctx.actor, action: "work_item.handoff", cwd, details: { workItemId, prNumber: handedOff.pullRequest?.number } });
        ctx.respondJson(res, 200, { ok: true, workItem: handedOff });
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

async function reconcileWorkItem(workItem: WorkItem, engine: WorkEngine, ctx: ServerRouteContext): Promise<WorkItem> {
  if (workItem.linkedRuns.length === 0) return workItem;
  const jobs = (await Promise.all(workItem.linkedRuns.map((runId) => ctx.queue.get(runId)))).filter((job): job is NonNullable<typeof job> => job !== null);
  return engine.reconcileRunResults(workItem, jobs);
}

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
