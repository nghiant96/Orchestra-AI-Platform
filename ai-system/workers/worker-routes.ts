import type http from "node:http";
import { canPerformAction } from "../core/permissions.js";
import {
  registerWorker,
  updateHeartbeat,
  setWorkerStatus,
  listWorkers,
  getWorker,
  WorkerServiceError
} from "./worker-service.js";
import { WorkerStore, resolveWorkerStoreDir } from "./worker-store.js";
import type { RouteHandler, ServerRouteContext } from "../server/routes-context.js";
import type { Worker } from "./worker-types.js";

const workerStoreCache = new Map<string, WorkerStore>();

function getOrCreateStore(defaultCwd: string): WorkerStore {
  let store = workerStoreCache.get(defaultCwd);
  if (!store) {
    store = new WorkerStore(resolveWorkerStoreDir(defaultCwd));
    workerStoreCache.set(defaultCwd, store);
  }
  return store;
}

function buildServiceCtx(req: http.IncomingMessage, ctx: ServerRouteContext) {
  const store = getOrCreateStore(ctx.defaultCwd);
  return {
    store,
    auditLog: ctx.auditLog,
    actor: ctx.actor,
    allowedRoots: ctx.allowedRoots
  };
}

export const workerRoutes: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/workers" && req.method === "GET") {
      const serviceCtx = buildServiceCtx(req, ctx);
      const workers = await listWorkers(serviceCtx);
      ctx.respondJson(res, 200, { ok: true, version: 1, workers: workers.map(sanitizeWorker) });
      return true;
    }

    if (url.pathname === "/workers" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const serviceCtx = buildServiceCtx(req, ctx);
      try {
        const worker = await registerWorker(serviceCtx, {
          name: typeof payload?.name === "string" ? payload.name : "",
          version: typeof payload?.version === "string" ? payload.version : undefined,
          os: typeof payload?.os === "string" ? payload.os : undefined,
          arch: typeof payload?.arch === "string" ? payload.arch : undefined,
          labels: Array.isArray(payload?.labels)
            ? payload.labels.filter((l: unknown) => typeof l === "string")
            : undefined,
          capabilities: payload?.capabilities && typeof payload.capabilities === "object"
            ? payload.capabilities as any
            : undefined,
          workspaceRoots: Array.isArray(payload?.workspaceRoots)
            ? payload.workspaceRoots.filter((r: unknown) => typeof r === "string")
            : undefined
        });
        ctx.respondJson(res, 201, { ok: true, worker });
        return true;
      } catch (err) {
        if (err instanceof WorkerServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    const workerMatch = /^\/workers\/([^/]+)(?:\/(heartbeat|disable|enable|drain))?$/.exec(url.pathname);
    if (workerMatch) {
      const workerId = workerMatch[1] ?? "";
      const action = workerMatch[2];
      const serviceCtx = buildServiceCtx(req, ctx);

      if (req.method === "GET" && !action) {
        const worker = await getWorker(serviceCtx, workerId);
        if (!worker) {
          ctx.respondJson(res, 404, { ok: false, error: "Worker not found" });
          return true;
        }
        ctx.respondJson(res, 200, { ok: true, worker: sanitizeWorker(worker) });
        return true;
      }

      if (req.method === "POST" && action) {
        if (action === "heartbeat") {
          const payload = await readJsonBody(req);
          try {
            const worker = await updateHeartbeat(serviceCtx, workerId, {
              status: payload?.status,
              currentJobId: typeof payload?.currentJobId === "string" ? payload.currentJobId : undefined,
              freeDiskGb: typeof payload?.freeDiskGb === "number" ? payload.freeDiskGb : undefined,
              cpuLoad: typeof payload?.cpuLoad === "number" ? payload.cpuLoad : undefined
            });
            ctx.respondJson(res, 200, { ok: true, worker: sanitizeWorker(worker) });
            return true;
          } catch (err) {
            if (err instanceof WorkerServiceError) {
              ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
              return true;
            }
            throw err;
          }
        }

        if (action === "disable" || action === "enable" || action === "drain") {
          if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "worker.manage")) {
            ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
            return true;
          }
          try {
            const worker = await setWorkerStatus(serviceCtx, workerId, action);
            ctx.respondJson(res, 200, { ok: true, worker: sanitizeWorker(worker) });
            return true;
          } catch (err) {
            if (err instanceof WorkerServiceError) {
              ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
              return true;
            }
            throw err;
          }
        }
      }
    }

    return false;
  }
};

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sanitizeWorker(worker: Worker): Omit<Worker, "sessionToken"> {
  const { sessionToken: _sessionToken, ...safe } = worker;
  return safe;
}
