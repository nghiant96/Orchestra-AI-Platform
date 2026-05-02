import type http from "node:http";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";
import { resolveApprovalPolicy } from "../../core/risk-policy.js";

export const healthRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname !== "/health" || req.method !== "GET") return false;
    const jobs = await ctx.queue.list();
    const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "waiting_for_approval");
    const queuedJobs = jobs.filter((j) => j.status === "queued");
    const { rules } = await ctx.globalRulesPromise;
    const approvalMode = resolveApprovalPolicy("", rules);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", Pragma: "no-cache", Expires: "0" });
    res.end(JSON.stringify({
      ok: true,
      status: "online",
      version: "2.0.0",
      cwd: ctx.defaultCwd,
      allowedWorkdirs: ctx.allowedRoots,
      queue: {
        concurrency: Math.max(1, Number(ctx.options.queueConcurrency || 1)),
        activeCount: activeJobs.length,
        queuedCount: queuedJobs.length,
        totalRecent: jobs.length,
        paused: ctx.queue.getPaused(),
        approvalMode: approvalMode.approvalMode,
        skipApproval: approvalMode.approvalMode === "auto",
        approvalPolicy: approvalMode
      },
      memory: {
        usage: process.memoryUsage(),
        uptime: process.uptime()
      }
    }, null, 2));
    return true;
  }
};
