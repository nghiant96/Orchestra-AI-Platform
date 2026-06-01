import type http from "node:http";
import { canPerformAction } from "../core/permissions.js";
import {
  registerWorker,
  updateHeartbeat,
  setWorkerStatus,
  listWorkers,
  getWorker,
  claimJob,
  completeJob,
  failJob,
  renewLease,
  startJob,
  sendMutationCheckpoint,
  appendWorkerLogs,
  recoverStalledJob,
  WorkerServiceError
} from "./worker-service.js";
import { WorkerStore, resolveWorkerStoreDir } from "./worker-store.js";
import type { RouteHandler, ServerRouteContext } from "../server/routes-context.js";
import type { Worker } from "./worker-types.js";
import type { QueueJob } from "../core/job-queue.js";

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

function buildExtendedServiceCtx(req: http.IncomingMessage, ctx: ServerRouteContext) {
  const store = getOrCreateStore(ctx.defaultCwd);
  return {
    store,
    auditLog: ctx.auditLog,
    actor: ctx.actor,
    allowedRoots: ctx.allowedRoots,
    queue: ctx.queue
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
            const leaseId = typeof payload?.leaseId === "string" ? payload.leaseId : "";
            const requestedJobId = typeof payload?.jobId === "string" ? payload.jobId : "";
            const worker = await updateHeartbeat(serviceCtx, workerId, {
              status: payload?.status,
              currentJobId: typeof payload?.currentJobId === "string" ? payload.currentJobId : undefined,
              freeDiskGb: typeof payload?.freeDiskGb === "number" ? payload.freeDiskGb : undefined,
              cpuLoad: typeof payload?.cpuLoad === "number" ? payload.cpuLoad : undefined
            });

            let leaseRenewed: boolean | undefined;
            let leaseError: string | undefined;
            const jobId = requestedJobId || worker.currentJobId || "";
            if (leaseId && jobId) {
              const extendedCtx = buildExtendedServiceCtx(req, ctx);
              if (payload?.status === "busy") {
                const started = await startJob(extendedCtx, workerId, jobId, leaseId);
                if (!started.ok) {
                  leaseRenewed = false;
                  leaseError = started.error || "Failed to start job";
                }
              }
              if (leaseError === undefined) {
                const renewed = await renewLease(extendedCtx, workerId, jobId, leaseId);
                leaseRenewed = renewed.ok;
                leaseError = renewed.error;
              }
            }

            if (payload?.status === "busy" && leaseId && jobId && leaseRenewed === false) {
              ctx.respondJson(res, 409, { ok: false, worker: sanitizeWorker(worker), leaseRenewed, leaseError });
              return true;
            }

            ctx.respondJson(res, 200, { ok: true, worker: sanitizeWorker(worker), leaseRenewed, leaseError });
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

    const claimMatch = /^\/workers\/([^/]+)\/jobs\/claim$/.exec(url.pathname);
    if (claimMatch && req.method === "POST") {
      const workerId = claimMatch[1] ?? "";
      const serviceCtx = buildExtendedServiceCtx(req, ctx);
      try {
        const result = await claimJob(serviceCtx, workerId);
        ctx.respondJson(res, 200, { ok: true, job: result.job, lease: result.lease, retryAfterMs: result.retryAfterMs, rejectionReason: result.rejectionReason });
        return true;
      } catch (err) {
        if (err instanceof WorkerServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    const completeFailMatch = /^\/jobs\/([^/]+)\/(complete|fail)$/.exec(url.pathname);
    if (completeFailMatch && req.method === "POST") {
      const jobId = completeFailMatch[1] ?? "";
      const action = completeFailMatch[2] as "complete" | "fail";
      const payload = await readJsonBody(req);
      const leaseId = typeof payload?.leaseId === "string" ? payload.leaseId : "";
      const workerId = typeof payload?.workerId === "string" ? payload.workerId : "";
      const serviceCtx = buildExtendedServiceCtx(req, ctx);

      if (!leaseId || !workerId) {
        ctx.respondJson(res, 400, { ok: false, error: "leaseId and workerId are required" });
        return true;
      }

      try {
        if (action === "complete") {
          const result = await completeJob(serviceCtx, workerId, jobId, leaseId, normalizeWorkerResultPayload(payload));
          ctx.respondJson(res, result.ok ? 200 : 400, result);
        } else {
          const errorMsg = typeof payload?.message === "string" ? payload.message : "Job failed";
          const result = await failJob(serviceCtx, workerId, jobId, leaseId, errorMsg, normalizeWorkerResultPayload(payload));
          ctx.respondJson(res, result.ok ? 200 : 400, result);
        }
        return true;
      } catch (err) {
        if (err instanceof WorkerServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    const startMatch = /^\/jobs\/([^/]+)\/start$/.exec(url.pathname);
    if (startMatch && req.method === "POST") {
      const jobId = startMatch[1] ?? "";
      const payload = await readJsonBody(req);
      const leaseId = typeof payload?.leaseId === "string" ? payload.leaseId : "";
      const workerId = typeof payload?.workerId === "string" ? payload.workerId : "";
      const serviceCtx = buildExtendedServiceCtx(req, ctx);

      if (!leaseId || !workerId) {
        ctx.respondJson(res, 400, { ok: false, error: "leaseId and workerId are required" });
        return true;
      }

      try {
        const result = await startJob(serviceCtx, workerId, jobId, leaseId);
        ctx.respondJson(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        if (err instanceof WorkerServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    const logsMatch = /^\/workers\/([^/]+)\/jobs\/([^/]+)\/logs$/.exec(url.pathname);
    if (logsMatch && req.method === "POST") {
      const workerId = logsMatch[1] ?? "";
      const jobId = logsMatch[2] ?? "";
      const payload = await readJsonBody(req);
      const leaseId = typeof payload?.leaseId === "string" ? payload.leaseId : "";
      const lines = Array.isArray(payload?.lines)
        ? payload.lines.filter((line: unknown): line is string => typeof line === "string")
        : typeof payload?.line === "string"
          ? [payload.line]
          : [];

      if (!leaseId) {
        ctx.respondJson(res, 400, { ok: false, error: "leaseId is required" });
        return true;
      }
      if (lines.length === 0) {
        ctx.respondJson(res, 400, { ok: false, error: "At least one log line is required" });
        return true;
      }

      try {
        const result = await appendWorkerLogs(buildExtendedServiceCtx(req, ctx), workerId, jobId, leaseId, lines);
        ctx.respondJson(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        if (err instanceof WorkerServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    const checkpointMatch = /^\/jobs\/([^/]+)\/checkpoint$/.exec(url.pathname);
    if (checkpointMatch && req.method === "POST") {
      const jobId = checkpointMatch[1] ?? "";
      const payload = await readJsonBody(req);
      const leaseId = typeof payload?.leaseId === "string" ? payload.leaseId : "";
      const workerId = typeof payload?.workerId === "string" ? payload.workerId : "";
      const serviceCtx = buildExtendedServiceCtx(req, ctx);

      if (!leaseId || !workerId) {
        ctx.respondJson(res, 400, { ok: false, error: "leaseId and workerId are required" });
        return true;
      }

      try {
        const result = await sendMutationCheckpoint(serviceCtx, workerId, jobId, leaseId, {
          stage: typeof payload?.stage === "string" ? payload.stage : "unknown",
          filesystemMutated: payload?.filesystemMutated === true,
          worktreePath: typeof payload?.worktreePath === "string" ? payload.worktreePath : undefined
        });
        ctx.respondJson(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        if (err instanceof WorkerServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
      }
    }

    const recoverMatch = /^\/jobs\/([^/]+)\/recover$/.exec(url.pathname);
    if (recoverMatch && req.method === "POST") {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "queue.pause")) {
        ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
        return true;
      }
      const jobId = recoverMatch[1] ?? "";
      const serviceCtx = buildExtendedServiceCtx(req, ctx);
      try {
        const result = await recoverStalledJob(serviceCtx, jobId);
        ctx.respondJson(res, result.ok ? 200 : 400, result);
        return true;
      } catch (err) {
        if (err instanceof WorkerServiceError) {
          ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
          return true;
        }
        throw err;
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

function normalizeWorkerResultPayload(payload: Record<string, unknown>): Partial<QueueJob> {
  const result: Partial<QueueJob> = {};
  const resultSummary = typeof payload.resultSummary === "string"
    ? payload.resultSummary
    : typeof payload.summary === "string"
      ? payload.summary
      : undefined;
  if (resultSummary !== undefined) result.resultSummary = resultSummary;
  if (typeof payload.artifactPath === "string" || payload.artifactPath === null) result.artifactPath = payload.artifactPath;
  if (Array.isArray(payload.workerLogs)) {
    result.workerLogs = payload.workerLogs.filter((line): line is string => typeof line === "string");
  }
  if (Array.isArray(payload.diffSummaries)) result.diffSummaries = payload.diffSummaries as QueueJob["diffSummaries"];
  if (Array.isArray(payload.latestToolResults)) result.latestToolResults = payload.latestToolResults as QueueJob["latestToolResults"];
  if (payload.failure && typeof payload.failure === "object") result.failure = payload.failure as QueueJob["failure"];
  if (payload.execution && typeof payload.execution === "object") result.execution = payload.execution as QueueJob["execution"];
  return result;
}
