import http from "node:http";
import path from "node:path";
import { Orchestrator } from "./core/orchestrator.js";
import { FileBackedJobQueue, resolveJobQueueDirectory, type JobRunner, type QueueJob } from "./core/job-queue.js";
import { resolveApprovalPolicy } from "./core/risk-policy.js";
import { FileAuditLog, parseAuditActor, resolveAuditLogPath } from "./core/audit-log.js";
import {
  listRecentRunSummaries,
  runArtifactRetentionCleanup
} from "./core/artifacts.js";
import { classifyServerError } from "./core/server-analytics.js";
import { loadRules } from "./core/orchestrator-runtime.js";
import { WebhookManager } from "./core/webhooks.js";
import { cleanupWorkspaceLifecycle } from "./work/worktree-cleanup.js";
import { healthRoute } from "./server/routes/health.js";
import { adminRoute } from "./server/routes/admin.js";
import { jobsRoute } from "./server/routes/jobs.js";
import { configRoute } from "./server/routes/config.js";
import { workItemsRoute } from "./server/routes/work-items.js";
import type { RouteHandler, ServerRouteContext } from "./server/routes-context.js";
import type { Logger, RulesConfig, RunStatus } from "./types.js";

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
  const authToken = options.authToken?.trim() || "";
  const requiresAuth = authToken.length > 0;
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

  const pendingApprovals = new Map<
    string,
    {
      resolve: (value: boolean) => void;
      type: "plan" | "checkpoint";
      data?: any;
    }
  >();
  const auditLog = new FileAuditLog(resolveAuditLogPath(defaultCwd));

  const runner: JobRunner =
    options.runner ??
    (async ({ jobId, task, cwd, dryRun, resume, workflowMode, externalTask, signal }) => {
      const confirmationHandler: import("./types.js").ConfirmationHandler = {
        confirmPlan: async (plan) => {
          return new Promise((resolve) => {
            pendingApprovals.set(jobId, { resolve, type: "plan", data: plan });
            void queue.get(jobId).then((j) => {
              if (j)
                queue.updateJob(j, {
                  status: "waiting_for_approval",
                  resultSummary: `Plan ready: ${plan.writeTargets.length} files to be modified.`,
                  execution: {
                    ...j.execution,
                    pendingPlan: plan
                  }
                });
            });
            broadcastLog("info", "Waiting for user approval of the plan...", jobId);
          });
        },
        confirmCheckpoint: async (message, artifactPath) => {
          return new Promise((resolve) => {
            pendingApprovals.set(jobId, { resolve, type: "checkpoint", data: { message, artifactPath } });
            void queue.get(jobId).then((j) => {
              if (j) queue.updateJob(j, { status: "waiting_for_approval" });
            });
            broadcastLog("info", `Checkpoint: ${message}. Waiting for approval...`, jobId);
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

      if (resume) {
        return orchestrator.resume(jobId, {
          signal
        });
      }

      const { rules } = await loadRules(cwd);
      const approvalMode = resolveApprovalPolicy(task, rules);
      return orchestrator.run(task, {
        dryRun,
        interactive: approvalMode.interactive,
        pauseAfterPlan: approvalMode.pauseAfterPlan,
        pauseAfterGenerate: approvalMode.pauseAfterGenerate,
        approvalPolicy: approvalMode,
        externalTask: externalTask ?? null,
        workflowMode: workflowMode ?? "standard",
        signal
      });
    });

  const queue = new FileBackedJobQueue(resolveJobQueueDirectory(defaultCwd), runner, {
    concurrency: options.queueConcurrency,
    logger: options.logger
  });
  let maintenanceTimer: NodeJS.Timeout | null = null;
  let isClosed = false;
  let currentGlobalRules: RulesConfig | null = null;
  const globalRulesPromise = loadRules(defaultCwd);

  // Load rules once for global server maintenance tasks
  void globalRulesPromise.then(({ rules }) => {
    currentGlobalRules = rules;

    const webhookManager = new WebhookManager(rules);
    auditLog.setOnEvent((event) => {
      void webhookManager.dispatch(event);
    });

    if (isClosed) {
      return;
    }

    const runMaintenance = async () => {
      options.logger.info("Running system maintenance and retention cleanup...");
      for (const root of allowedRoots) {
        try {
          const { rules: projectRules } = await loadRules(root);
          await runArtifactRetentionCleanup(root, projectRules, options.logger);
          await cleanupWorkspaceLifecycle(root, projectRules);
        } catch {
          // Fallback to global rules for cleanup if project rules fail
          await runArtifactRetentionCleanup(root, rules, options.logger);
          await cleanupWorkspaceLifecycle(root, rules);
        }
      }
      await auditLog.runRetentionCleanup(rules.retention?.audit_days ?? 30);
      queue.setRetentionDays(rules.retention?.queue_days);
      await queue.runRetentionCleanup();
    };

    // Run initial retention cleanup
    void runMaintenance();

    // Set up periodic cleanup (every 24 hours)
    maintenanceTimer = setInterval(() => {
      void runMaintenance();
    }, 24 * 60 * 60 * 1000);
    maintenanceTimer.unref?.();
  });

  queue.start();

  const server = http.createServer(async (req, res) => {
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
      const routeContext: ServerRouteContext = {
        defaultCwd,
        allowedRoots,
        options: {
          authToken,
          queueConcurrency: options.queueConcurrency,
          logger: { info: options.logger.info.bind(options.logger), warn: options.logger.warn.bind(options.logger) }
        },
        queue,
        runNow: (input) => runner(input),
        auditLog,
        pendingApprovals,
        currentGlobalRules,
        globalRulesPromise,
        actor: resolveRouteActor(
          req.headers,
          currentGlobalRules ?? (await globalRulesPromise).rules,
          requiresAuth
        ),
        broadcastLog,
        resolveRequestedCwd,
        resolveOptionalRequestedCwd,
        isAuthorized: (request) => isAuthorized(request, authToken),
        respondJson
      };

      if (requiresAuth && !isAuthorized(req, authToken)) {
        return respondJson(res, 401, {
          ok: false,
          error: "Unauthorized"
        });
      }

      if (url.pathname === "/logs" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        res.write(": ok\n\n");
        logClients.add(res);
        req.on("close", () => {
          logClients.delete(res);
        });
        return;
      }

      if (url.pathname === "/health" && req.method === "GET") {
        if (await healthRoute.handle(req, res, url, routeContext)) {
          return;
        }
      }

      const routeHandlers: RouteHandler[] = [adminRoute, jobsRoute, configRoute, workItemsRoute];
      for (const route of routeHandlers) {
        if (await route.handle(req, res, url, routeContext)) {
          return;
        }
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
  server.on("close", () => {
    isClosed = true;
    if (maintenanceTimer) {
      clearInterval(maintenanceTimer);
      maintenanceTimer = null;
    }
    void queue.stop();
  });
  return server;
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

function resolveOptionalRequestedCwd(value: unknown, defaultCwd: string, allowedRoots: string[]): string | null {
  return resolveRequestedCwd(typeof value === "string" && value.trim() ? value : undefined, defaultCwd, allowedRoots);
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

function resolveRouteActor(
  headers: http.IncomingMessage["headers"],
  rules: RulesConfig,
  requiresAuth: boolean
): ReturnType<typeof parseAuditActor> {
  const actor = parseAuditActor(headers, rules);
  if (requiresAuth) {
    return actor;
  }

  const actorId = firstHeader(headers["x-ai-system-actor"]) || "dashboard";
  const roleHeader = firstHeader(headers["x-ai-system-role"]);
  if (roleHeader || rules.auth?.role_mapping?.[actorId]) {
    return actor;
  }

  return { ...actor, role: "operator" };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveQueueRunApprovalMode(rules: RulesConfig): { interactive: boolean; pauseAfterPlan: boolean } {
  const skipApproval = (rules as RulesConfig & { skip_approval?: boolean }).skip_approval === true;
  return {
    interactive: !skipApproval,
    pauseAfterPlan: !skipApproval
  };
}

export function mapRunSummaryToQueueJob(run: Awaited<ReturnType<typeof listRecentRunSummaries>>[number], defaultCwd: string): QueueJob {
  return {
    version: 1,
    jobId: run.runName,
    status: normalizeRunStatus(run.status),
    task: run.task,
    cwd: defaultCwd,
    dryRun: run.dryRun,
    approvalMode:
      run.approvalPolicy?.approvalMode ??
      (run.status === "paused_after_plan" || run.status === "paused_after_generate" ? "manual" : undefined),
    approvalPolicy: run.approvalPolicy ?? undefined,
    createdAt: run.updatedAt || new Date().toISOString(),
    updatedAt: run.updatedAt || new Date().toISOString(),
    artifactPath: run.runPath,
    resultSummary: run.execution?.failure?.reason || run.status,
    failure: run.status === "failed" ? classifyServerError(run.execution?.failure?.reason) : undefined,
    diffSummaries: run.diffSummaries,
    latestToolResults: run.latestToolResults,
    execution: run.execution
      ? {
          transitions: run.execution.transitions,
          providerMetrics: run.execution.providerMetrics,
          budget: run.execution.budget,
          totalDurationMs: run.execution.totalDurationMs,
          retryHint: run.execution.retryHint ?? null
        }
      : undefined
  };
}

function normalizeRunStatus(status: RunStatus | string): QueueJob["status"] {
  switch (status) {
    case "completed":
    case "resumed_completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "paused_after_plan":
    case "paused_after_generate":
      return "waiting_for_approval";
    default:
      return "failed";
  }
}

function respondJson(res: http.ServerResponse, statusCode: number, body: unknown): boolean {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0"
  });
  res.end(JSON.stringify(body, null, 2));
  return true;
}
