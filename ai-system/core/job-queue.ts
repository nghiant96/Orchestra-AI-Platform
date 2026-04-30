import fs from "node:fs/promises";
import path from "node:path";
import type { ApprovalPolicyDecision, FailureMetadata, Logger, OrchestratorResult, PlanResult, RetryHint } from "../types.js";

export type QueueJobStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancel_requested" | "cancelled";

export type QueueApprovalMode = "manual" | "auto";

export interface QueueJob {
  version: number;
  jobId: string;
  status: QueueJobStatus;
  task: string;
  cwd: string;
  dryRun: boolean;
  resume?: boolean;
  approvalMode?: QueueApprovalMode;
  approvalPolicy?: ApprovalPolicyDecision;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  waitTimeMs?: number;
  executionTimeMs?: number;
  artifactPath?: string | null;
  resultSummary?: string | null;
  error?: string | null;
  failure?: FailureMetadata;
  diffSummaries?: import("../types.js").DiffSummary[];
  latestToolResults?: import("../types.js").ToolExecutionResult[];
  execution?: {
    transitions?: import("../types.js").ExecutionTransition[];
    providerMetrics?: import("../types.js").ExecutionProviderMetric[];
    budget?: import("../types.js").ExecutionBudgetSummary | null;
    totalDurationMs?: number;
    pendingPlan?: PlanResult;
    retryHint?: RetryHint | null;
  };
}

export interface JobQueueRunInput {
  jobId: string;
  task: string;
  cwd: string;
  dryRun: boolean;
  resume?: boolean;
  approvalMode?: QueueApprovalMode;
  approvalPolicy?: ApprovalPolicyDecision;
  signal?: AbortSignal;
}

export type JobRunner = (input: JobQueueRunInput) => Promise<OrchestratorResult>;

export class FileBackedJobQueue {
  private activeJobs = 0;
  private drainTimer: NodeJS.Timeout | null = null;
  private controllers = new Map<string, AbortController>();
  private activeWorkspaces = new Set<string>();
  private activeRunPromises = new Set<Promise<void>>();
  private isPaused = false;
  private isStopped = false;

  constructor(
    readonly jobsDir: string,
    private readonly runner: JobRunner,
    private readonly options: {
      concurrency?: number;
      logger?: Logger;
      retentionDays?: number;
    } = {}
  ) {}

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (!paused && !this.isStopped) {
      this.scheduleDrain();
    }
  }

  getPaused(): boolean {
    return this.isPaused;
  }

  async enqueue(input: Omit<JobQueueRunInput, "jobId">): Promise<QueueJob> {
    const now = new Date().toISOString();
    const job: QueueJob = {
      version: 1,
      jobId: createJobId(),
      status: "queued",
      task: input.task,
      cwd: input.cwd,
      dryRun: input.dryRun,
      resume: input.resume,
      approvalMode: input.approvalMode,
      approvalPolicy: input.approvalPolicy,
      createdAt: now,
      updatedAt: now,
      artifactPath: null,
      resultSummary: null,
      error: null
    };
    await this.writeJob(job);
    this.scheduleDrain();
    void this.cleanupOldJobs();
    return job;
  }

  async get(jobId: string): Promise<QueueJob | null> {
    if (!isSafeJobId(jobId)) {
      return null;
    }
    try {
      const raw = await fs.readFile(this.jobPath(jobId), "utf8");
      return JSON.parse(raw) as QueueJob;
    } catch {
      return null;
    }
  }

  async list(limit = 50): Promise<QueueJob[]> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    let entries: string[];
    try {
      entries = await fs.readdir(this.jobsDir);
    } catch {
      return [];
    }
    const jobs = await Promise.all(
      entries.filter((entry) => entry.endsWith(".json")).map((entry) => this.get(entry.replace(/\.json$/, "")))
    );
    return jobs
      .filter((job): job is QueueJob => job !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async cancel(jobId: string): Promise<QueueJob | null> {
    const job = await this.get(jobId);
    if (!job) {
      return null;
    }

    const controller = this.controllers.get(jobId);
    if (controller) {
      this.options.logger?.info(`Cancelling active job ${jobId}...`);
      controller.abort();
      this.controllers.delete(jobId);
    }

    if (job.status === "queued") {
      return this.updateJob(job, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        resultSummary: "Job cancelled before it started."
      });
    }

    if (job.status === "running" || job.status === "waiting_for_approval") {
      return this.updateJob(job, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        resultSummary: "Job cancelled by user."
      });
    }

    return job;
  }

  async delete(jobId: string): Promise<boolean> {
    if (!isSafeJobId(jobId)) {
      return false;
    }
    try {
      await fs.unlink(this.jobPath(jobId));
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    this.isStopped = false;
    this.scheduleDrain();
    this.cleanupHungJobs();
  }

  async stop(): Promise<void> {
    this.isStopped = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    await Promise.allSettled([...this.activeRunPromises]);
  }

  private async cleanupHungJobs(): Promise<void> {
    // Mark jobs that were 'running' when the server stopped as 'failed'
    const jobs = await this.list(100);
    const hungJobs = jobs.filter((j) => j.status === "running" || j.status === "cancel_requested");
    for (const job of hungJobs) {
      this.options.logger?.warn(`Cleaning up hung job ${job.jobId} from previous session.`);
      await this.updateJob(job, {
        status: "failed",
        error: "Job was interrupted by server restart.",
        finishedAt: new Date().toISOString()
      });
    }
  }

  private scheduleDrain(): void {
    if (this.isStopped) {
      return;
    }
    if (this.drainTimer) {
      return;
    }
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.drain();
    }, 50);
  }

  private async drain(): Promise<void> {
    if (this.isPaused || this.isStopped) {
      return;
    }
    const concurrency = Math.max(1, Number(this.options.concurrency || 1));
    while (this.activeJobs < concurrency) {
      const all = await this.list(100);
      const next = [...all].reverse().find((job) => job.status === "queued" && !this.activeWorkspaces.has(job.cwd));
      if (!next) {
        break;
      }
      this.activeJobs += 1;
      this.activeWorkspaces.add(next.cwd);
      const runPromise = this.runJob(next).finally(() => {
        this.activeJobs -= 1;
        this.activeWorkspaces.delete(next.cwd);
        this.activeRunPromises.delete(runPromise);
        this.scheduleDrain();
      });
      this.activeRunPromises.add(runPromise);
      void runPromise;
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    const latest = await this.get(job.jobId);
    if (!latest || latest.status !== "queued") {
      return;
    }

    const controller = new AbortController();
    this.controllers.set(job.jobId, controller);

    const startedAt = new Date();
    const waitTimeMs = startedAt.getTime() - new Date(latest.createdAt).getTime();

    const running = await this.updateJob(latest, {
      status: "running",
      startedAt: startedAt.toISOString(),
      waitTimeMs,
      error: null
    });

    try {
      const result = await this.runner({
        jobId: running.jobId,
        task: running.task,
        cwd: running.cwd,
        dryRun: running.dryRun,
        resume: running.resume,
        signal: controller.signal
      });

      // Check if it was cancelled during execution
      if (controller.signal.aborted) {
        const finishedAt = new Date().toISOString();
        const executionTimeMs = new Date(finishedAt).getTime() - startedAt.getTime();
        await this.updateJob(running, {
          status: "cancelled",
          finishedAt,
          executionTimeMs,
          resultSummary: "Job was aborted."
        });
        return;
      }

      const current = (await this.get(running.jobId)) ?? running;
      const status: QueueJobStatus = result.ok ? "completed" : "failed";
      const finishedAt = new Date().toISOString();
      const executionTimeMs = new Date(finishedAt).getTime() - startedAt.getTime();

      await this.updateJob(current, {
        status,
        finishedAt,
        executionTimeMs,
        artifactPath: result.artifacts?.runPath ?? null,
        resultSummary: summarizeOrchestratorResult(result),
        error: result.ok ? null : (result.execution?.failure?.reason ?? "Run failed."),
        approvalPolicy: result.approvalPolicy ?? current.approvalPolicy,
        approvalMode: result.approvalPolicy?.approvalMode ?? current.approvalMode,
        diffSummaries: result.diffSummaries,
        latestToolResults: result.latestToolResults,
        execution: result.execution
          ? {
              transitions: result.execution.transitions,
              providerMetrics: result.execution.providerMetrics,
              budget: result.execution.budget,
              totalDurationMs: result.execution.totalDurationMs,
              retryHint: result.execution.retryHint ?? null
            }
          : undefined
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const finishedAt = new Date().toISOString();
      const executionTimeMs = new Date(finishedAt).getTime() - startedAt.getTime();
      await this.updateJob(running, {
        status: isAbort ? "cancelled" : "failed",
        finishedAt,
        executionTimeMs,
        error: (error as Error).message,
        resultSummary: isAbort ? "Job aborted." : "Job failed before producing a run result."
      });
      this.options.logger?.error(`Queued job ${running.jobId} ${isAbort ? "aborted" : "failed"}: ${(error as Error).message}`);
    } finally {
      this.controllers.delete(job.jobId);
    }
  }

  async updateJob(job: QueueJob, patch: Partial<QueueJob>): Promise<QueueJob> {
    const updated: QueueJob = {
      ...job,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await this.writeJob(updated);
    return updated;
  }

  private async writeJob(job: QueueJob): Promise<void> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    await fs.writeFile(this.jobPath(job.jobId), `${JSON.stringify(job, null, 2)}\n`, "utf8");
  }

  private jobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private async cleanupOldJobs(): Promise<void> {
    try {
      const all = await this.list(500);
      const retentionDays = this.options.retentionDays;

      if (retentionDays && retentionDays > 0) {
        const now = Date.now();
        const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
        const toDelete = all.filter((job) => now - new Date(job.createdAt).getTime() > maxAgeMs);

        for (const job of toDelete) {
          try {
            await fs.unlink(this.jobPath(job.jobId));
          } catch {
            /* ignore */
          }
        }
        if (toDelete.length > 0) {
          this.options.logger?.info(`Cleaned up ${toDelete.length} old job record(s) based on retention policy (${retentionDays} days).`);
        }
        return;
      }

      if (all.length <= 100) return;

      const toDelete = all.slice(100);
      for (const job of toDelete) {
        try {
          await fs.unlink(this.jobPath(job.jobId));
        } catch {
          /* ignore */
        }
      }
      this.options.logger?.info(`Cleaned up ${toDelete.length} old job records.`);
    } catch (err) {
      this.options.logger?.warn(`Failed to cleanup old jobs: ${(err as Error).message}`);
    }
  }
}

export function resolveJobQueueDirectory(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "jobs");
}

function createJobId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSafeJobId(jobId: string): boolean {
  return /^[a-z0-9-]+$/i.test(jobId);
}

function summarizeOrchestratorResult(result: OrchestratorResult): string {
  if (result.result?.summary) {
    return result.result.summary;
  }
  if (result.status) {
    return `Run ${result.status}.`;
  }
  return result.ok ? "Run completed." : "Run failed.";
}
