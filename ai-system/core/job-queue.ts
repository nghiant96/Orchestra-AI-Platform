import fs from "node:fs/promises";
import path from "node:path";
import type { Logger, OrchestratorResult } from "../types.js";

export type QueueJobStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export interface QueueJob {
  jobId: string;
  status: QueueJobStatus;
  task: string;
  cwd: string;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  artifactPath?: string | null;
  resultSummary?: string | null;
  error?: string | null;
  diffSummaries?: import("../types.js").DiffSummary[];
  latestToolResults?: import("../types.js").ToolExecutionResult[];
  execution?: {
    transitions?: import("../types.js").ExecutionTransition[];
    providerMetrics?: import("../types.js").ExecutionProviderMetric[];
    budget?: import("../types.js").ExecutionBudgetSummary | null;
    totalDurationMs?: number;
  };
}

export interface JobQueueRunInput {
  jobId: string;
  task: string;
  cwd: string;
  dryRun: boolean;
}

export type JobRunner = (input: JobQueueRunInput) => Promise<OrchestratorResult>;

export class FileBackedJobQueue {
  private activeJobs = 0;
  private drainTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly jobsDir: string,
    private readonly runner: JobRunner,
    private readonly options: {
      concurrency?: number;
      logger?: Logger;
    } = {}
  ) {}

  async enqueue(input: JobQueueRunInput): Promise<QueueJob> {
    const now = new Date().toISOString();
    const job: QueueJob = {
      jobId: createJobId(),
      status: "queued",
      task: input.task,
      cwd: input.cwd,
      dryRun: input.dryRun,
      createdAt: now,
      updatedAt: now,
      artifactPath: null,
      resultSummary: null,
      error: null
    };
    await this.writeJob(job);
    this.scheduleDrain();
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
    const entries = await fs.readdir(this.jobsDir);
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => this.get(entry.replace(/\.json$/, "")))
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
    if (job.status === "queued") {
      return this.updateJob(job, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        resultSummary: "Job cancelled before it started."
      });
    }
    if (job.status === "running") {
      return this.updateJob(job, {
        status: "cancel_requested",
        resultSummary: "Cancellation requested; current run will stop at the next supported boundary."
      });
    }
    return job;
  }

  start(): void {
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainTimer) {
      return;
    }
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.drain();
    }, 50);
  }

  private async drain(): Promise<void> {
    const concurrency = Math.max(1, Number(this.options.concurrency || 1));
    while (this.activeJobs < concurrency) {
      const next = (await this.list(100)).reverse().find((job) => job.status === "queued");
      if (!next) {
        break;
      }
      this.activeJobs += 1;
      void this.runJob(next).finally(() => {
        this.activeJobs -= 1;
        this.scheduleDrain();
      });
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    const latest = await this.get(job.jobId);
    if (!latest || latest.status !== "queued") {
      return;
    }

    const running = await this.updateJob(latest, {
      status: "running",
      startedAt: new Date().toISOString(),
      error: null
    });

    try {
      const result = await this.runner({
        jobId: running.jobId,
        task: running.task,
        cwd: running.cwd,
        dryRun: running.dryRun
      });
      const current = (await this.get(running.jobId)) ?? running;
      const status: QueueJobStatus = current.status === "cancel_requested" ? "cancel_requested" : result.ok ? "completed" : "failed";
      await this.updateJob(current, {
        status,
        finishedAt: new Date().toISOString(),
        artifactPath: result.artifacts?.runPath ?? null,
        resultSummary: summarizeOrchestratorResult(result),
        error: result.ok ? null : result.execution?.failure?.reason ?? "Run failed.",
        diffSummaries: result.diffSummaries,
        latestToolResults: result.latestToolResults,
        execution: result.execution ? { 
          transitions: result.execution.transitions,
          providerMetrics: result.execution.providerMetrics,
          budget: result.execution.budget,
          totalDurationMs: result.execution.totalDurationMs
        } : undefined
      });
    } catch (error) {
      await this.updateJob(running, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: (error as Error).message,
        resultSummary: "Job failed before producing a run result."
      });
      this.options.logger?.error(`Queued job ${running.jobId} failed: ${(error as Error).message}`);
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
