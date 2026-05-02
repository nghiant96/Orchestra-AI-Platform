import type http from "node:http";
import { roleCan } from "../../core/audit-log.js";
import { aggregateProjectStats } from "../../core/server-analytics.js";
import { appendProjectLesson, readProjectLessons } from "../../core/lessons.js";
import { buildProjectRegistry } from "../../core/project-registry.js";
import { canPerformAction } from "../../core/permissions.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";

export const adminRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/projects" && req.method === "GET") {
      const projects = await buildProjectRegistry(ctx.allowedRoots, loadRules);
      ctx.respondJson(res, 200, { ok: true, version: 1, projects });
      return true;
    }

    if (url.pathname === "/stats" && req.method === "GET") {
      const cwd = ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const { rules } = await loadRules(cwd);
      ctx.respondJson(res, 200, await aggregateProjectStats(cwd, rules));
      return true;
    }

    if (url.pathname === "/lessons" && req.method === "GET") {
      const cwd = ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      const limit = Number(url.searchParams.get("limit") || 10);
      ctx.respondJson(res, 200, { ok: true, version: 1, lessons: await readProjectLessons(cwd, limit) });
      return true;
    }

    if (url.pathname === "/lessons" && req.method === "POST") {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "work_item.create")) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      const payload = await readJsonBody(req);
      const cwd = ctx.resolveRequestedCwd(payload?.cwd, ctx.defaultCwd, ctx.allowedRoots);
      const title = typeof payload?.title === "string" ? payload.title.trim() : "";
      const body = typeof payload?.body === "string" ? payload.body.trim() : "";
      if (!cwd) {
        ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        return true;
      }
      if (!title || !body) {
        ctx.respondJson(res, 400, { ok: false, error: "Missing lesson title or body" });
        return true;
      }
      await appendProjectLesson(cwd, { title, body });
      await ctx.auditLog.append({ actor: ctx.actor, action: "lesson.create", cwd, details: { title } });
      ctx.respondJson(res, 201, { ok: true, version: 1, lesson: { title, body } });
      return true;
    }

    if ((url.pathname === "/queue/pause" || url.pathname === "/queue/resume" || url.pathname === "/queue/clear-finished") && req.method === "POST") {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "queue.pause")) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      if (url.pathname === "/queue/pause") {
        ctx.queue.setPaused(true);
        await ctx.auditLog.append({ actor: ctx.actor, action: "queue.pause", cwd: ctx.defaultCwd });
        ctx.respondJson(res, 200, { ok: true, paused: true });
        return true;
      }
      if (url.pathname === "/queue/resume") {
        ctx.queue.setPaused(false);
        await ctx.auditLog.append({ actor: ctx.actor, action: "queue.resume", cwd: ctx.defaultCwd });
        ctx.respondJson(res, 200, { ok: true, paused: false });
        return true;
      }
      ctx.respondJson(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/audit" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 100);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", Pragma: "no-cache", Expires: "0" });
      res.end(JSON.stringify({ ok: true, version: 1, events: await ctx.auditLog.list(limit) }, null, 2));
      return true;
    }
    if (url.pathname === "/audit/export" && req.method === "GET") {
      if (!roleCan(ctx.actor, "operator")) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Operator role required" }, null, 2));
        return true;
      }
      const limit = Number(url.searchParams.get("limit") || 1000);
      const format = url.searchParams.get("format") || "json";
      const events = await ctx.auditLog.list(limit);
      if (format === "jsonl") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
        res.end(events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, version: 1, events }, null, 2));
      return true;
    }
    return false;
  }
};

async function loadRules(cwd: string) {
  const { loadRules } = await import("../../core/orchestrator-runtime.js");
  return loadRules(cwd);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
