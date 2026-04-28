import http from "node:http";
import path from "node:path";
import { Orchestrator } from "./core/orchestrator.js";
import { FileBackedJobQueue, resolveJobQueueDirectory, type JobRunner } from "./core/job-queue.js";
import type { Logger } from "./types.js";

export interface ServerAppOptions {
  defaultCwd: string;
  authToken?: string;
  logger: Logger;
  allowedWorkdirs?: string[];
  queueConcurrency?: number;
  runner?: JobRunner;
}

export function createAiSystemServer(options: ServerAppOptions): http.Server {
  const defaultCwd = path.resolve(options.defaultCwd);
  const allowedRoots = normalizeAllowedWorkdirs(options.allowedWorkdirs, defaultCwd);
  const runner: JobRunner =
    options.runner ??
    (async ({ task, cwd, dryRun }) => {
      const orchestrator = new Orchestrator({
        repoRoot: cwd,
        logger: options.logger
      });
      return orchestrator.run(task, { dryRun });
    });
  const queue = new FileBackedJobQueue(resolveJobQueueDirectory(defaultCwd), runner, {
    concurrency: options.queueConcurrency,
    logger: options.logger
  });
  queue.start();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/health" && req.method === "GET") {
        return respondJson(res, 200, {
          ok: true,
          mode: "server",
          cwd: defaultCwd,
          queue: {
            enabled: true,
            concurrency: Math.max(1, Number(options.queueConcurrency || 1))
          }
        });
      }

      if (!isAuthorized(req, options.authToken || "")) {
        return respondJson(res, 401, {
          ok: false,
          error: "Unauthorized"
        });
      }

      if (url.pathname === "/run" && req.method === "POST") {
        const payload = await readJsonBody(req);
        if (!payload?.task || typeof payload.task !== "string") {
          return respondJson(res, 400, {
            ok: false,
            error: "Missing task"
          });
        }

        const cwd = resolveRequestedCwd(payload.cwd, defaultCwd, allowedRoots);
        if (!cwd) {
          return respondJson(res, 403, {
            ok: false,
            error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS"
          });
        }

        const result = await runner({
          task: payload.task,
          cwd,
          dryRun: payload.dryRun !== false
        });

        return respondJson(res, result.ok ? 200 : 422, result);
      }

      if (url.pathname === "/jobs" && req.method === "POST") {
        const payload = await readJsonBody(req);
        if (!payload?.task || typeof payload.task !== "string") {
          return respondJson(res, 400, {
            ok: false,
            error: "Missing task"
          });
        }
        const cwd = resolveRequestedCwd(payload.cwd, defaultCwd, allowedRoots);
        if (!cwd) {
          return respondJson(res, 403, {
            ok: false,
            error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS"
          });
        }
        const job = await queue.enqueue({
          task: payload.task,
          cwd,
          dryRun: payload.dryRun !== false
        });
        return respondJson(res, 202, {
          jobId: job.jobId,
          status: job.status
        });
      }

      if (url.pathname === "/jobs" && req.method === "GET") {
        return respondJson(res, 200, {
          jobs: await queue.list()
        });
      }

      const jobMatch = /^\/jobs\/([^/]+)(?:\/(cancel))?$/.exec(url.pathname);
      if (jobMatch && req.method === "GET" && !jobMatch[2]) {
        const job = await queue.get(jobMatch[1] ?? "");
        return job ? respondJson(res, 200, job) : respondJson(res, 404, { ok: false, error: "Job not found" });
      }

      if (jobMatch && req.method === "POST" && jobMatch[2] === "cancel") {
        const job = await queue.cancel(jobMatch[1] ?? "");
        return job ? respondJson(res, 200, job) : respondJson(res, 404, { ok: false, error: "Job not found" });
      }

      return respondJson(res, 404, {
        ok: false,
        error: "Not found"
      });
    } catch (error) {
      const normalized = error as Error;
      return respondJson(res, 500, {
        ok: false,
        error: normalized.message
      });
    }
  });
}

function normalizeAllowedWorkdirs(values: string[] | undefined, defaultCwd: string): string[] {
  const candidates = values && values.length > 0 ? values : [defaultCwd];
  return candidates.map((entry) => path.resolve(entry.trim())).filter(Boolean);
}

function resolveRequestedCwd(value: unknown, defaultCwd: string, allowedRoots: string[]): string | null {
  const requested =
    typeof value === "string" && value.trim()
      ? path.isAbsolute(value)
        ? path.resolve(value)
        : path.resolve(defaultCwd, value)
      : defaultCwd;
  return allowedRoots.some((root) => isPathWithinRoot(root, requested)) ? requested : null;
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  if (!token) {
    return true;
  }

  const header = req.headers.authorization || req.headers["x-api-key"];
  return header === `Bearer ${token}` || header === token;
}

function respondJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
