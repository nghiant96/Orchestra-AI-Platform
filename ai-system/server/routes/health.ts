import type http from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";
import { resolveApprovalPolicy } from "../../core/risk-policy.js";
import { resolveExecutionBackend } from "../../core/execution-backend.js";
import { resolveOrchestraStoreDescriptor } from "../../core/orchestra-store.js";
import { createWorkerStore } from "../../workers/worker-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgVersion: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../../package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export const healthRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname !== "/health" || req.method !== "GET") return false;
    const jobs = await ctx.queue.list();
    const activeJobs = jobs.filter((j) => j.status === "assigned" || j.status === "running" || j.status === "waiting_for_approval");
    const queuedJobs = jobs.filter((j) => j.status === "queued");
    const stalledJobs = jobs.filter((j) => j.status === "stalled");
    const workerStore = createWorkerStore(ctx.defaultCwd);
    const workers = await workerStore.list();
    const workerStatusCounts = workers.reduce<Record<string, number>>((acc, worker) => {
      acc[worker.status] = (acc[worker.status] ?? 0) + 1;
      return acc;
    }, {});
    const { rules } = await ctx.globalRulesPromise;
    const approvalMode = resolveApprovalPolicy("", rules);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", Pragma: "no-cache", Expires: "0" });
    res.end(JSON.stringify({
      ok: true,
      status: "online",
      version: pkgVersion,
      cwd: ctx.defaultCwd,
      allowedWorkdirs: ctx.allowedRoots,
      executionBackend: resolveExecutionBackend(),
      store: resolveOrchestraStoreDescriptor(),
      queue: {
        concurrency: Math.max(1, Number(ctx.options.queueConcurrency || 1)),
        activeCount: activeJobs.length,
        queuedCount: queuedJobs.length,
        stalledCount: stalledJobs.length,
        totalRecent: jobs.length,
        paused: ctx.queue.getPaused(),
        approvalMode: approvalMode.approvalMode,
        skipApproval: approvalMode.approvalMode === "auto",
        approvalPolicy: approvalMode
      },
      workers: {
        totalCount: workers.length,
        onlineCount: workerStatusCounts.online ?? 0,
        idleCount: workerStatusCounts.idle ?? 0,
        busyCount: workerStatusCounts.busy ?? 0,
        drainingCount: workerStatusCounts.draining ?? 0,
        disabledCount: workerStatusCounts.disabled ?? 0,
        offlineCount: workerStatusCounts.offline ?? 0
      },
      memory: {
        usage: process.memoryUsage(),
        uptime: process.uptime()
      }
    }, null, 2));
    return true;
  }
};
