import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { Orchestrator } from "./core/orchestrator.js";
import { FileBackedJobQueue, resolveJobQueueDirectory, type JobRunner, type QueueJob } from "./core/job-queue.js";
import { listRecentRunSummaries, loadRunSummary } from "./core/artifacts.js";
import { loadRules } from "./core/orchestrator-runtime.js";
import {
  loadJsonIfExists,
  writeJsonFile,
  resolveProjectConfigPath,
  mergeConfig
} from "./utils/config.js";
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
  const logClients = new Set<http.ServerResponse>();
  const originalOnLog = options.logger.onLog;

  const broadcastLog = (level: string, message: string, jobId?: string) => {
    const data = JSON.stringify({ level, message, jobId, timestamp: new Date().toISOString() });
    for (const client of logClients) {
      client.write(`data: ${data}\n\n`);
    }
  };

  options.logger.onLog = (level, message) => {
    originalOnLog?.(level, message);
    broadcastLog(level, message);
  };

  const pendingApprovals = new Map<string, {
    resolve: (value: boolean) => void,
    type: 'plan' | 'checkpoint',
    data?: any
  }>();

  const runner: JobRunner =
    options.runner ??
    (async ({ jobId, task, cwd, dryRun }) => {
      const confirmationHandler: import("./types.js").ConfirmationHandler = {
        confirmPlan: async (plan) => {
          return new Promise((resolve) => {
            pendingApprovals.set(jobId, { resolve, type: 'plan', data: plan });
            void queue.get(jobId).then(j => {
              if (j) queue.updateJob(j, { status: 'waiting_for_approval' });
            });
            broadcastLog('info', 'Waiting for user approval of the plan...', jobId);
          });
        },
        confirmCheckpoint: async (message, artifactPath) => {
          return new Promise((resolve) => {
            pendingApprovals.set(jobId, { resolve, type: 'checkpoint', data: { message, artifactPath } });
            void queue.get(jobId).then(j => {
              if (j) queue.updateJob(j, { status: 'waiting_for_approval' });
            });
            broadcastLog('info', `Checkpoint: ${message}. Waiting for approval...`, jobId);
          });
        }
      };

      const scopedLogger: Logger = {
        ...options.logger,
        step: (m) => options.logger.step(m),
        info: (m) => options.logger.info(m),
        warn: (m) => options.logger.warn(m),
        error: (m) => options.logger.error(m),
        success: (m) => options.logger.success(m),
        onLog: (level, message) => {
          originalOnLog?.(level, message);
          broadcastLog(level, message, jobId);
        }
      };

      const orchestrator = new Orchestrator({
        repoRoot: cwd,
        logger: scopedLogger,
        confirmationHandler
      });
      return orchestrator.run(task, {
        dryRun,
        interactive: true,
        pauseAfterPlan: true
      });
    });

  const queue = new FileBackedJobQueue(resolveJobQueueDirectory(defaultCwd), runner, {
    concurrency: options.queueConcurrency,
    logger: options.logger
  });
  queue.start();

  return http.createServer(async (req, res) => {
    // Basic CORS support
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/", "http://localhost");

      if (url.pathname === "/logs" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        res.write(": ok\n\n");
        logClients.add(res);
        req.on("close", () => {
          logClients.delete(res);
        });
        return;
      }

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
          jobId: `run-${Date.now().toString(36)}`,
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
          jobId: `job-${Date.now().toString(36)}`,
          task: payload.task,
          cwd,
          dryRun: payload.dryRun !== false
        });
        return respondJson(res, 202, job);
      }

      const contentMatch = /^\/jobs\/([^/]+)\/files\/content$/.exec(url.pathname);
      if (contentMatch && req.method === "GET") {
        const jobId = contentMatch[1] ?? "";
        const filePath = url.searchParams.get("path");
        const type = url.searchParams.get("type") || "generated"; // "original" or "generated"

        if (!filePath) {
          return respondJson(res, 400, { ok: false, error: "Missing path parameter" });
        }

        const job = await queue.get(jobId);
        let artifactPath = job?.artifactPath;

        if (!artifactPath && jobId.startsWith("run-")) {
          const { rules } = await loadRules(defaultCwd);
          const artifactsDir = path.resolve(defaultCwd, rules.artifacts?.data_dir || ".ai-system-artifacts");
          artifactPath = path.join(artifactsDir, jobId);
        }

        if (!artifactPath) {
          return respondJson(res, 404, { ok: false, error: "Job not found or no artifacts" });
        }

        try {
          const indexPath = path.join(artifactPath, "artifact-index.json");
          const index = await loadJsonIfExists<any>(indexPath);
          const latestIterationPath = index?.latestIterationPath;

          if (!latestIterationPath) {
            return respondJson(res, 404, { ok: false, error: "No iteration data found" });
          }

          const iterationDir = path.isAbsolute(latestIterationPath)
            ? latestIterationPath
            : path.join(artifactPath, latestIterationPath);

          const subDir = type === "original" ? "files-original" : "files";
          const fullPath = path.join(iterationDir, subDir, filePath);

          try {
            const content = await fs.readFile(fullPath, "utf8");
            return respondJson(res, 200, { ok: true, content });
          } catch {
            return respondJson(res, 404, { ok: false, error: "File not found in artifacts" });
          }
        } catch (err) {
          return respondJson(res, 500, { ok: false, error: (err as Error).message });
        }
      }

      if (url.pathname === "/config" && req.method === "POST") {
        try {
          const payload = await readJsonBody(req);
          const configPath = await resolveProjectConfigPath(defaultCwd);

          if (!configPath) {
            return respondJson(res, 404, { ok: false, error: "Project config file not found. Create .ai-system.json first." });
          }

          const existing = await loadJsonIfExists<any>(configPath) || {};
          const updated = mergeConfig(existing, payload);
          await writeJsonFile(configPath, updated);

          options.logger.info(`System configuration updated via Dashboard.`);
          return respondJson(res, 200, { ok: true, config: updated });
        } catch (err) {
          return respondJson(res, 500, { ok: false, error: (err as Error).message });
        }
      }

      if (url.pathname === "/config" && req.method === "GET") {
        try {
          const { rules, profile, globalProfile } = await loadRules(defaultCwd);
          // Mask sensitive info
          const safeRules = JSON.parse(JSON.stringify(rules));
          if (safeRules.providers) {
            for (const provider of Object.values(safeRules.providers as Record<string, any>)) {
              if (provider.api_key) provider.api_key = "********";
            }
          }
          if (safeRules.memory?.api_key) safeRules.memory.api_key = "********";

          return respondJson(res, 200, {
            rules: safeRules,
            profile,
            globalProfile
          });
        } catch (err) {
          return respondJson(res, 500, { ok: false, error: (err as Error).message });
        }
      }

      if (url.pathname === "/jobs" && req.method === "GET") {
        const jobs = await queue.list();

        // Also load recent runs from artifacts to show CLI runs
        try {
          const { rules } = await loadRules(defaultCwd);
          const recentRuns = await listRecentRunSummaries(defaultCwd, rules, 20);

          const runJobs: QueueJob[] = recentRuns
            .filter(run => !jobs.some(j => j.artifactPath === run.runPath || j.jobId === run.runName))
            .map(run => ({
              jobId: run.runName,
              status: run.status as any,
              task: run.task,
              cwd: defaultCwd,
              dryRun: run.dryRun,
              createdAt: run.updatedAt || new Date().toISOString(),
              updatedAt: run.updatedAt || new Date().toISOString(),
              artifactPath: run.runPath,
              resultSummary: run.execution?.failure?.reason || run.status,
              diffSummaries: run.diffSummaries,
              latestToolResults: run.latestToolResults,
              execution: run.execution ? {
                transitions: run.execution.transitions,
                providerMetrics: run.execution.providerMetrics,
                budget: run.execution.budget,
                totalDurationMs: run.execution.totalDurationMs
              } : undefined
            }));

          const merged = [...jobs, ...runJobs].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

          return respondJson(res, 200, {
            jobs: merged.slice(0, 50)
          });
        } catch {
          // If artifacts can't be loaded, just return queue jobs
          return respondJson(res, 200, { jobs });
        }
      }

      const approvalMatch = /^\/jobs\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
      if (approvalMatch && req.method === "POST") {
        const jobId = approvalMatch[1] ?? "";
        const action = approvalMatch[2];
        const pending = pendingApprovals.get(jobId);

        if (!pending) {
          return respondJson(res, 404, { ok: false, error: "No pending approval for this job" });
        }

        const approved = action === "approve";
        pending.resolve(approved);
        pendingApprovals.delete(jobId);

        const job = await queue.get(jobId);
        if (job) {
          await queue.updateJob(job, { status: "running" });
        }

        options.logger.info(`Job ${jobId} ${approved ? 'approved' : 'rejected'} via Dashboard.`);
        return respondJson(res, 200, { ok: true, action });
      }

      const jobMatch = /^\/jobs\/([^/]+)(?:\/(cancel))?$/.exec(url.pathname);
      if (jobMatch && req.method === "GET" && !jobMatch[2]) {
        const jobId = jobMatch[1] ?? "";
        let job = await queue.get(jobId);

        if (!job && jobId.startsWith("run-")) {
          try {
            const { rules } = await loadRules(defaultCwd);
            const summary = await loadRunSummary(defaultCwd, rules, jobId);
            if (summary && summary.runState) {
              job = {
                jobId: jobId,
                status: (summary.runState.status || "completed") as any,
                task: summary.runState.task || "",
                cwd: defaultCwd,
                dryRun: summary.runState.dryRun || false,
                createdAt: summary.runState.execution?.transitions?.[0]?.timestamp || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                artifactPath: path.dirname(summary.statePath),
                resultSummary: summary.runState.latestReviewSummary,
                error: summary.runState.status === "failed" ? "Run failed." : null,
                diffSummaries: summary.runState.diffSummaries || summary.artifactIndex?.diffSummaries,
                latestToolResults: summary.runState.latestToolResults || summary.artifactIndex?.latestToolResults,
                execution: summary.runState.execution ? { transitions: summary.runState.execution.transitions } : undefined
              };
            }
          } catch {
            // Not found in artifacts either
          }
        }

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
