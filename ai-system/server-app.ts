import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { Orchestrator } from "./core/orchestrator.js";
import { parseExternalTask, normalizeExternalTaskToPrompt } from "./core/external-task.js";
import { FileBackedJobQueue, resolveJobQueueDirectory, type JobRunner, type QueueJob } from "./core/job-queue.js";
import { resolveApprovalPolicy } from "./core/risk-policy.js";
import { FileAuditLog, parseAuditActor, resolveAuditLogPath, roleCan } from "./core/audit-log.js";
import { buildProjectRegistry } from "./core/project-registry.js";
import { appendProjectLesson, proposeLessonsFromRuns, readProjectLessons } from "./core/lessons.js";
import {
  listRecentRunSummaries,
  loadRunSummary,
  runArtifactRetentionCleanup
} from "./core/artifacts.js";
import { aggregateProjectStats, classifyServerError } from "./core/server-analytics.js";
import { loadRules } from "./core/orchestrator-runtime.js";
import { WebhookManager } from "./core/webhooks.js";
import { loadJsonIfExists, writeJsonFile, resolveProjectConfigPath, mergeConfig } from "./utils/config.js";
import type { Logger, RulesConfig, RunStatus } from "./types.js";
import type { WorkflowMode } from "./core/workflow-modes.js";

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
        } catch {
          // Fallback to global rules for cleanup if project rules fail
          await runArtifactRetentionCleanup(root, rules, options.logger);
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
        const jobs = await queue.list();
        const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "waiting_for_approval");
        const queuedJobs = jobs.filter((j) => j.status === "queued");
        const { rules } = await loadRules(defaultCwd);
        const approvalMode = resolveApprovalPolicy("", rules);

        return respondJson(res, 200, {
          ok: true,
          status: "online",
          version: "2.0.0",
          cwd: defaultCwd,
          allowedWorkdirs: options.allowedWorkdirs || [defaultCwd],
          queue: {
            concurrency: Math.max(1, Number(options.queueConcurrency || 1)),
            activeCount: activeJobs.length,
            queuedCount: queuedJobs.length,
            totalRecent: jobs.length,
            paused: queue.getPaused(),
            approvalMode: approvalMode.approvalMode,
            skipApproval: approvalMode.approvalMode === "auto",
            approvalPolicy: approvalMode
          },
          memory: {
            usage: process.memoryUsage(),
            uptime: process.uptime()
          }
        });
      }

      if (!isAuthorized(req, options.authToken || "")) {
        return respondJson(res, 401, {
          ok: false,
          error: "Unauthorized"
        });
      }

      const actorRules = currentGlobalRules ?? (await globalRulesPromise).rules;
      const actor = parseAuditActor(req.headers, actorRules);

      if (url.pathname === "/projects" && req.method === "GET") {
        const projects = await buildProjectRegistry(options.allowedWorkdirs || [defaultCwd], async (cwd) => await loadRules(cwd));
        return respondJson(res, 200, { ok: true, version: 1, projects });
      }

      if (url.pathname === "/audit" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 100);
        return respondJson(res, 200, { ok: true, version: 1, events: await auditLog.list(limit) });
      }

      if (url.pathname === "/lessons" && req.method === "GET") {
        const cwd = resolveRequestedCwd(url.searchParams.get("cwd"), defaultCwd, allowedRoots) ?? defaultCwd;
        const { rules } = await loadRules(cwd);
        const runs = await Promise.all(
          (await listRecentRunSummaries(cwd, rules, 50)).map(async (entry) => await loadRunSummary(cwd, rules, entry.runName))
        );
        return respondJson(res, 200, {
          ok: true,
          version: 1,
          lessons: await readProjectLessons(cwd),
          proposals: proposeLessonsFromRuns(runs)
        });
      }

      if (url.pathname === "/lessons" && req.method === "POST") {
        if (!roleCan(actor, "operator")) {
          return respondJson(res, 403, { ok: false, error: "Operator role required" });
        }
        const payload = await readJsonBody(req);
        const cwd = resolveRequestedCwd(typeof payload.cwd === "string" ? payload.cwd : null, defaultCwd, allowedRoots) ?? defaultCwd;
        if (typeof payload.title !== "string" || typeof payload.body !== "string") {
          return respondJson(res, 400, { ok: false, error: "Missing lesson title or body" });
        }
        await appendProjectLesson(cwd, { title: payload.title, body: payload.body });
        await auditLog.append({ actor, action: "lesson.create", cwd, details: { title: payload.title } });
        return respondJson(res, 201, { ok: true });
      }

      if (url.pathname === "/run" && req.method === "POST") {
        const payload = await readJsonBody(req);
        const task = typeof payload?.task === "string" ? payload.task : "";
        if (!task) {
          return respondJson(res, 400, {
            ok: false,
            error: "Missing task"
          });
        }

        const cwd = resolveRequestedCwd(payload?.cwd, defaultCwd, allowedRoots);
        if (!cwd) {
          return respondJson(res, 403, {
            ok: false,
            error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS"
          });
        }

        const result = await runner({
          jobId: `run-${Date.now().toString(36)}`,
          task,
          cwd,
          dryRun: payload?.dryRun !== false
        });


        return respondJson(res, result.ok ? 200 : 422, result);
      }

      if (url.pathname === "/jobs" && req.method === "POST") {
        if (!roleCan(actor, "operator")) {
          return respondJson(res, 403, { ok: false, error: "Operator role required" });
        }
        const payload = await readJsonBody(req);
        const task = typeof payload?.task === "string" ? payload.task.trim() : "";
        const externalUrl = typeof payload?.externalUrl === "string" ? payload.externalUrl : "";

        let effectiveTask = task;
        let externalTask: import("./types.js").ExternalTaskRef | undefined;
        let effectiveWorkflowMode = parseWorkflowMode(payload?.workflowMode) ?? "standard";

        if (externalUrl || task) {
          const parsed = parseExternalTask(externalUrl || task);
          if (parsed) {
            externalTask = parsed;
            if (!effectiveTask || effectiveTask === parsed.url) effectiveTask = normalizeExternalTaskToPrompt(parsed);
            if (parsed.kind === "pull_request" && !payload?.workflowMode) {
              effectiveWorkflowMode = "review";
            }
          } else if (externalUrl) {
             return respondJson(res, 400, { ok: false, error: "Invalid external task URL" });
          }
        }

        if (!effectiveTask) {
          return respondJson(res, 400, {
            ok: false,
            error: "Missing task"
          });
        }
        const cwd = resolveRequestedCwd(payload?.cwd, defaultCwd, allowedRoots);

        if (!cwd) {
          return respondJson(res, 403, {
            ok: false,
            error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS"
          });
        }

        // Budget Enforcement: Check daily usage
        let approvalMode: ReturnType<typeof resolveApprovalPolicy> | null = null;
        try {
          const { rules } = await loadRules(cwd);
          approvalMode = resolveApprovalPolicy(effectiveTask, rules, [], { workflowMode: effectiveWorkflowMode as any });
          const maxDaily = rules.execution?.budgets?.max_daily_cost_units;
          if (maxDaily && maxDaily > 0) {
            // Self-call stats to get usage
            const stats = await aggregateProjectStats(cwd, rules);
            const todayStr = new Date().toISOString().split("T")[0];
            const todayCost = stats.costByDay.find((d) => d.date === todayStr)?.cost || 0;

            if (todayCost >= maxDaily) {
              return respondJson(res, 403, {
                ok: false,
                error: `Daily budget exceeded: ${todayCost.toFixed(2)}/${maxDaily} units used today.`
              });
            }
          }
        } catch (err) {
          options.logger.warn(`Daily budget check failed (ignoring): ${(err as Error).message}`);
        }

        const job = await queue.enqueue({
          task: effectiveTask,
          cwd,
          dryRun: payload?.dryRun !== false,
          workflowMode: effectiveWorkflowMode,
          approvalMode: approvalMode?.approvalMode ?? "manual",
          approvalPolicy: approvalMode ?? undefined,
          externalTask
        });
        await auditLog.append({
          actor,
          action: "job.create",
          cwd,
          jobId: job.jobId,
          details: {
            dryRun: job.dryRun,
            approvalMode: job.approvalMode,
            riskClass: job.approvalPolicy?.riskClass ?? null
          }
        });
        return respondJson(res, 202, job);
      }

      const contentMatch = /^\/jobs\/([^/]+)\/files\/content$/.exec(url.pathname);
      if (contentMatch && req.method === "GET") {
        const jobId = contentMatch[1] ?? "";
        const filePath = url.searchParams.get("path");
        const type = url.searchParams.get("type") || "generated"; // "original" or "generated"
        const requestedCwd = resolveOptionalRequestedCwd(url.searchParams.get("cwd"), defaultCwd, allowedRoots);
        if (!requestedCwd) {
          return respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        }

        if (!filePath) {
          return respondJson(res, 400, { ok: false, error: "Missing path parameter" });
        }

        const job = await queue.get(jobId);
        let artifactPath = job?.artifactPath;

        if (!artifactPath && jobId.startsWith("run-")) {
          const { rules } = await loadRules(requestedCwd);
          const artifactsDir = path.resolve(requestedCwd, rules.artifacts?.data_dir || ".ai-system-artifacts");
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

          const iterationDir = path.isAbsolute(latestIterationPath) ? latestIterationPath : path.join(artifactPath, latestIterationPath);

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
        if (!roleCan(actor, "admin")) {
          return respondJson(res, 403, { ok: false, error: "Admin role required" });
        }
        try {
          const payload = await readJsonBody(req);
          const configPath = await resolveProjectConfigPath(defaultCwd);

          if (!configPath) {
            return respondJson(res, 404, { ok: false, error: "Project config file not found. Create .ai-system.json first." });
          }

          const existing = (await loadJsonIfExists<any>(configPath)) || {};
          const updated = mergeConfig(existing, payload);
          await writeJsonFile(configPath, updated);
          await auditLog.append({
            actor,
            action: "config.update",
            cwd: defaultCwd,
            details: { configPath }
          });

          options.logger.info(`System configuration updated via Dashboard.`);
          return respondJson(res, 200, { ok: true, config: updated });
        } catch (err) {
          return respondJson(res, 500, { ok: false, error: (err as Error).message });
        }
      }

      if (url.pathname === "/queue/pause" && req.method === "POST") {
        if (!roleCan(actor, "operator")) {
          return respondJson(res, 403, { ok: false, error: "Operator role required" });
        }
        queue.setPaused(true);
        await auditLog.append({ actor, action: "queue.pause", cwd: defaultCwd });
        options.logger.info("System queue PAUSED via Dashboard.");
        return respondJson(res, 200, { ok: true, paused: true });
      }

      if (url.pathname === "/queue/resume" && req.method === "POST") {
        if (!roleCan(actor, "operator")) {
          return respondJson(res, 403, { ok: false, error: "Operator role required" });
        }
        queue.setPaused(false);
        await auditLog.append({ actor, action: "queue.resume", cwd: defaultCwd });
        options.logger.info("System queue RESUMED via Dashboard.");
        return respondJson(res, 200, { ok: true, paused: false });
      }

      if (url.pathname === "/queue/clear-finished" && req.method === "POST") {
        if (!roleCan(actor, "operator")) {
          return respondJson(res, 403, { ok: false, error: "Operator role required" });
        }
        const jobs = await queue.list(500);
        const finished = jobs.filter((j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled");
        let deletedCount = 0;
        for (const job of finished) {
          if (await queue.delete(job.jobId)) deletedCount++;
        }
        await auditLog.append({
          actor,
          action: "queue.clear_finished",
          cwd: defaultCwd,
          details: { deletedCount }
        });
        options.logger.info(`Cleared ${deletedCount} finished jobs from queue.`);
        return respondJson(res, 200, { ok: true, deletedCount });
      }

      if (url.pathname === "/config" && req.method === "GET") {
        try {
          const { rules, profile, globalProfile, plugins } = await loadRules(defaultCwd);
          // Mask sensitive info
          const safeRules = JSON.parse(JSON.stringify(rules));
          if (safeRules.providers) {
            for (const provider of Object.values(safeRules.providers as Record<string, any>)) {
              if (provider.api_key) provider.api_key = "********";
            }
          }
          if (safeRules.memory?.api_key) safeRules.memory.api_key = "********";

          return respondJson(res, 200, {
            version: 1,
            rules: safeRules,
            profile,
            globalProfile,
            plugins
          });
        } catch (err) {
          return respondJson(res, 500, { ok: false, error: (err as Error).message });
        }
      }

      if (url.pathname === "/stats" && req.method === "GET") {
        const filterCwd = resolveOptionalRequestedCwd(url.searchParams.get("cwd"), defaultCwd, allowedRoots);
        if (!filterCwd) {
          return respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        }
        try {
          const { rules } = await loadRules(filterCwd);
          const stats = await aggregateProjectStats(filterCwd, rules);
          return respondJson(res, 200, { ok: true, ...stats, version: 1 });
        } catch (err) {
          return respondJson(res, 500, { ok: false, error: (err as Error).message });
        }
      }

      if (url.pathname === "/jobs" && req.method === "GET") {
        const filterCwd = resolveOptionalRequestedCwd(url.searchParams.get("cwd"), defaultCwd, allowedRoots);
        if (!filterCwd) {
          return respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
        }
        const jobs = await queue.list();

        // Filter queue jobs by filterCwd if present
        const filteredQueueJobs = jobs.filter((j) => isPathWithinRoot(filterCwd, j.cwd));

        options.logger.info(`GET /jobs - Found ${filteredQueueJobs.length} jobs in queue${filterCwd ? ` for ${filterCwd}` : ""}`);

        // Load recent runs from artifacts
        try {
          const { rules } = await loadRules(filterCwd);
          const recentRuns = await listRecentRunSummaries(filterCwd, rules, 20);
          options.logger.info(`GET /jobs - Found ${recentRuns.length} recent runs in ${filterCwd}`);

          const runJobs: QueueJob[] = recentRuns
            .filter((run) => !jobs.some((j) => j.artifactPath === run.runPath || j.jobId === run.runName))
            .map((run) => mapRunSummaryToQueueJob(run, filterCwd));

          const merged = [...filteredQueueJobs, ...runJobs].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

          return respondJson(res, 200, {
            version: 1,
            jobs: merged.slice(0, 50)
          });
          } catch {
          // If artifacts can't be loaded, just return queue jobs
          return respondJson(res, 200, { version: 1, jobs: filteredQueueJobs });
          }

      }

      const approvalMatch = /^\/jobs\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
      if (approvalMatch && req.method === "POST") {
        if (!roleCan(actor, "operator")) {
          return respondJson(res, 403, { ok: false, error: "Operator role required" });
        }
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
        await auditLog.append({
          actor,
          action: approved ? "job.approve" : "job.reject",
          cwd: job?.cwd,
          jobId,
          details: { pendingType: pending.type }
        });

        options.logger.info(`Job ${jobId} ${approved ? "approved" : "rejected"} via Dashboard.`);
        return respondJson(res, 200, { ok: true, action });
      }

      const jobMatch = /^\/jobs\/([^/]+)(?:\/(cancel|resume|retry))?$/.exec(url.pathname);
      if (jobMatch && req.method === "GET" && !jobMatch[2]) {
        const jobId = jobMatch[1] ?? "";
        let job = await queue.get(jobId);

        if (!job && jobId.startsWith("run-")) {
          try {
            const requestedCwd = resolveOptionalRequestedCwd(url.searchParams.get("cwd"), defaultCwd, allowedRoots);
            if (!requestedCwd) {
              return respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
            }
            const { rules } = await loadRules(requestedCwd);
            const summary = await loadRunSummary(requestedCwd, rules, jobId);
            if (summary && summary.runState) {
              job = {
                version: 1,
                jobId: jobId,
                status: normalizeRunStatus(summary.runState.status || "completed"),
                task: summary.runState.task || "",
                cwd: requestedCwd,
                dryRun: summary.runState.dryRun || false,
                approvalMode:
                  summary.runState.approvalPolicy?.approvalMode ?? (summary.runState.status?.startsWith("paused_") ? "manual" : undefined),
                approvalPolicy: summary.runState.approvalPolicy ?? summary.artifactIndex?.approvalPolicy ?? undefined,
                createdAt: summary.runState.execution?.transitions?.[0]?.timestamp || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                artifactPath: path.dirname(summary.statePath),
                resultSummary: summary.runState.latestReviewSummary,
                error: summary.runState.status === "failed" ? "Run failed." : null,
                diffSummaries: summary.runState.diffSummaries || summary.artifactIndex?.diffSummaries,
                latestToolResults: summary.runState.latestToolResults || summary.artifactIndex?.latestToolResults,
                execution: summary.runState.execution
                  ? {
                      transitions: summary.runState.execution.transitions,
                      providerMetrics: summary.runState.execution.providerMetrics,
                      budget: summary.runState.execution.budget,
                      totalDurationMs: summary.runState.execution.totalDurationMs,
                      retryHint: summary.runState.execution.retryHint ?? null
                    }
                  : undefined
              };
            }
          } catch {
            // Not found in artifacts either
          }
        }

        return job ? respondJson(res, 200, job) : respondJson(res, 404, { ok: false, error: "Job not found" });
      }

      if (jobMatch && req.method === "POST" && jobMatch[2]) {
        const jobId = jobMatch[1] ?? "";
        const action = jobMatch[2];

        if (action === "cancel") {
          if (!roleCan(actor, "operator")) {
            return respondJson(res, 403, { ok: false, error: "Operator role required" });
          }
          const job = await queue.cancel(jobId);
          if (job) {
            await auditLog.append({ actor, action: "job.cancel", cwd: job.cwd, jobId });
          }
          return job ? respondJson(res, 200, job) : respondJson(res, 404, { ok: false, error: "Job not found" });
        }

        if (action === "resume") {
          if (!roleCan(actor, "operator")) {
            return respondJson(res, 403, { ok: false, error: "Operator role required" });
          }
          const job = await queue.get(jobId);
          if (!job) return respondJson(res, 404, { ok: false, error: "Job not found" });
          if (job.status !== "failed" && job.status !== "cancelled") {
            return respondJson(res, 400, { ok: false, error: "Only failed or cancelled jobs can be resumed" });
          }
          const updated = await queue.updateJob(job, { status: "queued", resume: true });
          await auditLog.append({ actor, action: "job.resume", cwd: updated.cwd, jobId });
          return respondJson(res, 200, updated);
        }

        if (action === "retry") {
          if (!roleCan(actor, "operator")) {
            return respondJson(res, 403, { ok: false, error: "Operator role required" });
          }
          const job = await queue.get(jobId);
          if (!job) return respondJson(res, 404, { ok: false, error: "Job not found" });
          const newJob = await queue.enqueue({
            task: job.task,
            cwd: job.cwd,
            dryRun: job.dryRun
          });
          await auditLog.append({ actor, action: "job.retry", cwd: job.cwd, jobId: newJob.jobId, details: { sourceJobId: jobId } });
          return respondJson(res, 201, newJob);
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

function parseWorkflowMode(value: unknown): WorkflowMode | null {
  return value === "standard" || value === "implement" || value === "review" || value === "fix" || value === "refactor"
    ? value
    : null;
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
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0"
  });
  res.end(JSON.stringify(body, null, 2));
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
