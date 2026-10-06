import path from "node:path";
import type { WorkflowMode } from "./workflow-modes.js";
import type { ApprovalPolicyDecision, FailureMetadata, Logger, OrchestratorResult, PlanResult, RetryHint } from "../types.js";
import type { WorkerCapabilities } from "../workers/worker-types.js";
import type { WorkflowProfileId } from "../workflows/workflow-profile.js";
import type { ApprovalArtifactBinding } from "../approvals/approval-proof.js";
import type { JobRepository } from "./repository-contracts.js";
import type { JobRecordRepository } from "./job-repository.js";
import { createJobRecordRepository } from "./job-repositories.js";

export type QueueJobStatus = "queued" | "assigned" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancel_requested" | "cancelled" | "stalled";

/** Statuses a job never leaves: only these may be pruned, and nothing may overwrite them. */
const FINISHED_STATUSES: ReadonlySet<QueueJobStatus> = new Set(["completed", "failed", "cancelled"]);

/** Records kept by the count-based retention when no `queue_days` is configured. */
const RETAINED_FINISHED_JOBS = 100;

const DRAIN_DELAY_MS = 50;
/** Back-off after a store failure, so an outage is not hammered every 50ms. */
const DRAIN_RETRY_DELAY_MS = 1000;

const LOCK_RETRY_ATTEMPTS = 8;
const LOCK_RETRY_BASE_DELAY_MS = 25;

export type QueueApprovalMode = "manual" | "auto";

export interface JobLease {
  workerId: string;
  leaseId: string;
  claimedAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
}

export interface MutationCheckpoint {
  jobId: string;
  leaseId: string;
  stage: string;
  filesystemMutated: boolean;
  worktreePath?: string;
  timestamp: string;
}

export interface QueueMutationResult {
  ok: boolean;
  error?: string;
}

export interface LeaseRenewResult extends QueueMutationResult {
  lease?: JobLease;
}

export interface QueueJob {
  version: number;
  jobId: string;
  status: QueueJobStatus;
  workerId?: string;
  task: string;
  cwd: string;
  dryRun: boolean;
  resume?: boolean;
  workflowMode?: WorkflowMode;
  workflowProfile?: WorkflowProfileId;
  approvalMode?: QueueApprovalMode;
  approvalPolicy?: ApprovalPolicyDecision;
  approvalArtifact?: ApprovalArtifactBinding | null;
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
  externalTask?: import("../types.js").ExternalTaskRef;
  /** Set when the job came from a work item graph node, for traceability and phase planning. */
  workItemId?: string;
  graphNodeId?: string;
  lease?: JobLease;
  attempt?: number;
  workerSelector?: {
    os?: string;
    labels?: string[];
  };
  requiredCapabilities?: Partial<WorkerCapabilities>;
  mutationCheckpoint?: MutationCheckpoint;
  workerLogs?: string[];
}

export interface JobQueueRunInput {
  jobId: string;
  task: string;
  cwd: string;
  dryRun: boolean;
  resume?: boolean;
  workflowMode?: WorkflowMode;
  workflowProfile?: WorkflowProfileId;
  approvalMode?: QueueApprovalMode;
  approvalPolicy?: ApprovalPolicyDecision;
  externalTask?: import("../types.js").ExternalTaskRef;
  workItemId?: string;
  graphNodeId?: string;
  signal?: AbortSignal;
}

export type JobRunner = (input: JobQueueRunInput) => Promise<OrchestratorResult>;

export class FileBackedJobQueue implements JobRepository {
  private activeJobs = 0;
  private drainTimer: NodeJS.Timeout | null = null;
  private controllers = new Map<string, AbortController>();
  private activeWorkspaces = new Set<string>();
  private activeRunPromises = new Set<Promise<void>>();
  /** In-flight drain, so stop() can wait for a pass that is mid-await. */
  private drainPromise: Promise<void> | null = null;
  private isPaused = false;
  private isStopped = false;
  private readonly repository: JobRecordRepository;

  constructor(
    readonly jobsDir: string,
    private readonly runner: JobRunner,
    private readonly options: {
      concurrency?: number;
      logger?: Logger;
      retentionDays?: number;
    } = {}
  ) {
    this.repository = createJobRecordRepository(jobsDir);
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (!paused && !this.isStopped) {
      this.scheduleDrain();
    }
  }

  getPaused(): boolean {
    return this.isPaused;
  }

  setRetentionDays(days: number | undefined): void {
    this.options.retentionDays = days;
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
      workflowMode: input.workflowMode,
      workflowProfile: input.workflowProfile,
      approvalMode: input.approvalMode,
      approvalPolicy: input.approvalPolicy,
      approvalArtifact: null,
      externalTask: input.externalTask,
      workItemId: input.workItemId,
      graphNodeId: input.graphNodeId,
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
    return this.repository.get(jobId);
  }

  async list(limit = 50): Promise<QueueJob[]> {
    return this.repository.list(limit);
  }

  async cancel(jobId: string): Promise<QueueJob | null> {
    if (!isSafeJobId(jobId)) {
      return null;
    }

    const controller = this.controllers.get(jobId);
    if (controller) {
      this.options.logger?.info(`Cancelling active job ${jobId}...`);
      controller.abort();
      this.controllers.delete(jobId);
    }

    // Under the job lock, a cancel is ordered against worker complete/fail and
    // the in-process run's final write: whichever lands first wins, and neither
    // overwrites the other from a stale read. Every unfinished status is
    // cancellable — including `assigned`, which a worker has claimed but not
    // started, and `stalled`, which is waiting for an operator.
    const outcome = await this.withJobLockRetrying(jobId, async () => {
      const job = await this.get(jobId);
      if (!job || FINISHED_STATUSES.has(job.status)) {
        return job;
      }
      return this.updateJob(job, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        resultSummary: job.status === "queued" ? "Job cancelled before it started." : "Job cancelled by user."
      });
    });
    if (!outcome) {
      throw new Error("Job is locked; retry");
    }
    return outcome.value;
  }

  /**
   * Run work outside the queue while holding its workspace: no queued job
   * starts in `cwd` meanwhile, and shutdown waits for it like any other run.
   * Refused — without calling `fn` — while the queue is paused or stopped, or
   * when something already runs in that workspace.
   */
  async runExclusive<T>(
    cwd: string,
    fn: () => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; reason: "paused" | "busy" }> {
    if (this.isPaused || this.isStopped) {
      return { ok: false, reason: "paused" };
    }
    if (this.activeWorkspaces.has(cwd)) {
      return { ok: false, reason: "busy" };
    }
    this.activeWorkspaces.add(cwd);
    const run = fn();
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.activeRunPromises.add(settled);
    try {
      return { ok: true, value: await run };
    } finally {
      this.activeRunPromises.delete(settled);
      this.activeWorkspaces.delete(cwd);
      this.scheduleDrain();
    }
  }

  /**
   * Record that an in-process run is waiting for approval — unless the job has
   * already finished. A cancel that lands first must not be turned back into a
   * job that looks like it is still waiting.
   */
  async markWaitingForApproval(jobId: string, patch: (job: QueueJob) => Partial<QueueJob>): Promise<void> {
    await this.withJobLockRetrying(jobId, async () => {
      const job = await this.get(jobId);
      if (!job || FINISHED_STATUSES.has(job.status)) {
        return;
      }
      await this.updateJob(job, { ...patch(job), status: "waiting_for_approval" });
    });
  }

  async delete(jobId: string): Promise<boolean> {
    if (!isSafeJobId(jobId)) {
      return false;
    }
    const removed = await this.repository.delete(jobId);
    return removed;
  }

  async runRetentionCleanup(): Promise<void> {
    await this.cleanupOldJobs();
  }

  async migrateLegacyJobsFromDisk(): Promise<number> {
    const imported = await this.repository.migrateLegacyJobsFromDisk();
    if (imported > 0) {
      this.scheduleDrain();
    }
    return imported;
  }

  async claimJob(jobId: string, lease: JobLease): Promise<QueueJob | null> {
    if (!isSafeJobId(jobId)) return null;

    return this.withJobLock(jobId, async () => {
      const job = await this.get(jobId);
      if (!job) return null;
      if (job.status !== "queued") return null;

      const now = Date.now();
      if (job.lease && new Date(job.lease.expiresAt).getTime() > now) {
        return null;
      }

      const updated: QueueJob = {
        ...job,
        status: "assigned",
        workerId: lease.workerId,
        lease,
        attempt: (job.attempt ?? 0) + 1,
        updatedAt: new Date().toISOString()
      };

      await this.writeJob(updated);

      const verify = await this.get(jobId);
      if (!verify || verify.lease?.leaseId !== lease.leaseId) {
        return null;
      }

      return verify;
    });
  }

  async completeJob(jobId: string, leaseId: string, result: Partial<QueueJob>): Promise<{ ok: boolean; error?: string }> {
    const locked = await this.withJobLock(jobId, async () => {
      const job = await this.get(jobId);
      if (!job) return { ok: false, error: "Job not found" };
      if (job.status === "cancelled") return { ok: false, error: "Job was cancelled" };

      if (!job.lease) return { ok: false, error: "No active lease" };
      if (job.lease.leaseId !== leaseId) {
        if (job.status === "completed" || job.status === "failed") {
          return { ok: true };
        }
        return { ok: false, error: "Invalid leaseId" };
      }

      // A repeated complete is idempotent; completing a job that already
      // failed would discard this result while reporting success.
      if (job.status === "completed") return { ok: true };
      if (job.status === "failed") return { ok: false, error: "Job already failed" };

      const now = Date.now();
      if (new Date(job.lease.expiresAt).getTime() < now) {
        return { ok: false, error: "Lease expired" };
      }

      const finishedAt = new Date().toISOString();
      const startedAt = job.startedAt ? new Date(job.startedAt) : new Date(finishedAt);

      const updated: QueueJob = {
        ...job,
        ...result,
        status: "completed",
        finishedAt,
        executionTimeMs: new Date(finishedAt).getTime() - startedAt.getTime(),
        updatedAt: finishedAt
      };

      await this.writeJob(updated);
      return { ok: true };
    });
    return locked ?? { ok: false, error: "Job is locked; retry" };
  }

  async failJob(jobId: string, leaseId: string, error: string, result: Partial<QueueJob> = {}): Promise<{ ok: boolean; error?: string }> {
    const locked = await this.withJobLock(jobId, async () => {
      const job = await this.get(jobId);
      if (!job) return { ok: false, error: "Job not found" };
      if (job.status === "cancelled") return { ok: false, error: "Job was cancelled" };

      if (!job.lease) return { ok: false, error: "No active lease" };
      if (job.lease.leaseId !== leaseId) {
        if (job.status === "completed" || job.status === "failed") {
          return { ok: true };
        }
        return { ok: false, error: "Invalid leaseId" };
      }

      if (job.status === "failed") return { ok: true };
      if (job.status === "completed") return { ok: false, error: "Job already completed" };

      const now = Date.now();
      if (new Date(job.lease.expiresAt).getTime() < now) {
        return { ok: false, error: "Lease expired" };
      }

      const finishedAt = new Date().toISOString();
      const startedAt = job.startedAt ? new Date(job.startedAt) : new Date(finishedAt);

      const updated: QueueJob = {
        ...job,
        ...result,
        status: "failed",
        error,
        finishedAt,
        executionTimeMs: new Date(finishedAt).getTime() - startedAt.getTime(),
        updatedAt: finishedAt
      };

      await this.writeJob(updated);
      return { ok: true };
    });
    return locked ?? { ok: false, error: "Job is locked; retry" };
  }

  async startJob(jobId: string, workerId: string, leaseId: string): Promise<QueueMutationResult> {
    const locked = await this.withJobLock(jobId, async () => {
      const job = await this.get(jobId);
      if (!job) return { ok: false, error: "Job not found" };
      if (!job.lease) return { ok: false, error: "No active lease" };
      if (job.lease.workerId !== workerId || job.lease.leaseId !== leaseId) {
        return { ok: false, error: "Invalid leaseId" };
      }
      if (new Date(job.lease.expiresAt).getTime() < Date.now()) {
        return { ok: false, error: "Lease expired" };
      }
      if (job.status === "running") return { ok: true };
      if (job.status !== "assigned") {
        return { ok: false, error: `Job status is ${job.status}, not assigned` };
      }

      const startedAt = new Date();
      await this.writeJob({
        ...job,
        status: "running",
        startedAt: job.startedAt ?? startedAt.toISOString(),
        waitTimeMs: job.waitTimeMs ?? startedAt.getTime() - new Date(job.createdAt).getTime(),
        updatedAt: startedAt.toISOString()
      });
      return { ok: true };
    });
    return locked ?? { ok: false, error: "Job is locked; retry" };
  }

  async renewLease(jobId: string, leaseId: string): Promise<LeaseRenewResult> {
    const locked = await this.withJobLock(jobId, async () => {
      const job = await this.get(jobId);
      if (!job) return { ok: false, error: "Job not found" };
      if (!job.lease) return { ok: false, error: "No active lease" };
      if (job.lease.leaseId !== leaseId) return { ok: false, error: "Invalid leaseId" };
      if (new Date(job.lease.expiresAt).getTime() < Date.now()) {
        return { ok: false, error: "Lease expired" };
      }
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        return { ok: false, error: `Job is already ${job.status}` };
      }

      const now = new Date();
      const updated: JobLease = {
        ...job.lease,
        lastHeartbeatAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString()
      };

      const updatedJob: QueueJob = {
        ...job,
        lease: updated,
        updatedAt: now.toISOString()
      };

      await this.writeJob(updatedJob);
      return { ok: true, lease: updated };
    });
    return locked ?? { ok: false, error: "Job is locked; retry" };
  }

  async saveCheckpoint(jobId: string, leaseId: string, checkpoint: { stage: string; filesystemMutated: boolean; worktreePath?: string }): Promise<{ ok: boolean; error?: string }> {
    const locked = await this.withJobLock(jobId, async () => {
      const job = await this.get(jobId);
      if (!job) return { ok: false, error: "Job not found" };
      if (!job.lease || job.lease.leaseId !== leaseId) return { ok: false, error: "Invalid leaseId" };
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        return { ok: false, error: `Job is already ${job.status}` };
      }

      const checkpointRecord: MutationCheckpoint = {
        jobId,
        leaseId,
        stage: checkpoint.stage,
        filesystemMutated: checkpoint.filesystemMutated,
        worktreePath: checkpoint.worktreePath,
        timestamp: new Date().toISOString()
      };

      const updated: QueueJob = {
        ...job,
        mutationCheckpoint: checkpointRecord,
        updatedAt: new Date().toISOString()
      };

      await this.writeJob(updated);
      return { ok: true };
    });
    return locked ?? { ok: false, error: "Job is locked; retry" };
  }

  async detectStaleLeases(): Promise<{ requeued: string[]; stalled: string[] }> {
    const now = Date.now();
    const all = await this.list(200);
    const requeued: string[] = [];
    const stalled: string[] = [];

    for (const job of all) {
      if (!job.lease) continue;
      if (new Date(job.lease.expiresAt).getTime() > now) continue;
      if (job.status !== "assigned" && job.status !== "running" && job.status !== "waiting_for_approval") continue;

      const transition = await this.withJobLock(job.jobId, async () => {
        const current = await this.get(job.jobId);
        if (!current?.lease) return "skip" as const;
        if (new Date(current.lease.expiresAt).getTime() > Date.now()) return "skip" as const;
        if (current.status !== "assigned" && current.status !== "running" && current.status !== "waiting_for_approval") return "skip" as const;

        const hasMutatedFilesystem = current.mutationCheckpoint?.filesystemMutated === true;

        if (hasMutatedFilesystem) {
          await this.writeJob({
            ...current,
            status: "stalled",
            updatedAt: new Date().toISOString()
          });
          return "stalled" as const;
        }

        await this.writeJob({
          ...current,
          status: "queued",
          lease: undefined,
          workerId: undefined,
          mutationCheckpoint: undefined,
          updatedAt: new Date().toISOString()
        });
        return "requeued" as const;
      });

      if (transition === "stalled") {
        stalled.push(job.jobId);
      } else if (transition === "requeued") {
        requeued.push(job.jobId);
      } else if (transition === null) {
        this.options.logger?.warn(`Skipped stale lease transition for locked job ${job.jobId}.`);
      }
    }

    return { requeued, stalled };
  }

  async recoverStalledJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
    const locked = await this.withJobLock(jobId, async () => {
      const job = await this.get(jobId);
      if (!job) return { ok: false, error: "Job not found" };
      if (job.status !== "stalled") return { ok: false, error: "Job is not stalled" };

      await this.writeJob({
        ...job,
        status: "queued",
        lease: undefined,
        workerId: undefined,
        mutationCheckpoint: undefined,
        attempt: (job.attempt ?? 0) + 1,
        updatedAt: new Date().toISOString()
      });

      return { ok: true };
    });
    return locked ?? { ok: false, error: "Job is locked; retry" };
  }

  start(): void {
    this.isStopped = false;
    this.scheduleDrain();
    void this.cleanupHungJobs().catch((error) => {
      this.options.logger?.warn(`Failed to clean up jobs interrupted by the last shutdown: ${(error as Error).message}`);
    });
  }

  async stop(): Promise<void> {
    this.isStopped = true;
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    // A drain that is mid-await has not registered its run promise yet, so
    // waiting only on activeRunPromises can return while that pass is still
    // about to launch a job — against a repository this method is closing.
    // Settle the drain first, then whatever it managed to start.
    await Promise.allSettled([this.drainPromise ?? Promise.resolve()]);
    await Promise.allSettled([...this.activeRunPromises]);
    await this.repository.close();
  }

  private async cleanupHungJobs(): Promise<void> {
    // An in-process run dies with the server, so its 'running' record is now
    // orphaned. A leased job is different: it runs in an external worker that
    // outlives a server restart, and failing it here threw away the result the
    // worker was about to report. Lease expiry (detectStaleLeases) decides
    // whether that worker is gone.
    const jobs = await this.list(100);
    const hungJobs = jobs.filter((j) => !j.lease && (j.status === "running" || j.status === "cancel_requested"));
    for (const job of hungJobs) {
      this.options.logger?.warn(`Cleaning up hung job ${job.jobId} from previous session.`);
      await this.updateJob(job, {
        status: "failed",
        error: "Job was interrupted by server restart.",
        finishedAt: new Date().toISOString()
      });
    }
  }

  private scheduleDrain(delayMs = DRAIN_DELAY_MS): void {
    if (this.isStopped) {
      return;
    }
    if (this.drainTimer) {
      return;
    }
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      const pass = this.drain()
        .catch((error) => {
          // Listing the queue fails while the store is down. Unhandled, that
          // rejection would take the whole server down with it.
          this.options.logger?.warn(`Queue drain failed; retrying: ${(error as Error).message}`);
          this.scheduleDrain(DRAIN_RETRY_DELAY_MS);
        })
        .finally(() => {
          if (this.drainPromise === pass) {
            this.drainPromise = null;
          }
        });
      this.drainPromise = pass;
    }, delayMs);
  }

  private async drain(): Promise<void> {
    if (this.isPaused || this.isStopped) {
      return;
    }
    const concurrency = Math.max(1, Number(this.options.concurrency || 1));
    while (this.activeJobs < concurrency) {
      const all = await this.list(100);
      // stop() may have landed while the listing was in flight; a job started
      // now would outlive the shutdown that is already underway.
      if (this.isPaused || this.isStopped) {
        break;
      }
      const next = [...all].reverse().find((job) => job.status === "queued" && !this.activeWorkspaces.has(job.cwd));
      if (!next) {
        break;
      }
      this.activeJobs += 1;
      this.activeWorkspaces.add(next.cwd);
      const runPromise = this.runJob(next)
        .then(
          () => DRAIN_DELAY_MS,
          (error: unknown) => {
            // runJob only rejects when the store itself fails around the run.
            this.options.logger?.error(`Queued job ${next.jobId} could not be processed: ${(error as Error).message}`);
            return DRAIN_RETRY_DELAY_MS;
          }
        )
        .then((delayMs) => {
          this.activeJobs -= 1;
          this.activeWorkspaces.delete(next.cwd);
          this.activeRunPromises.delete(runPromise);
          this.scheduleDrain(delayMs);
        });
      this.activeRunPromises.add(runPromise);
      void runPromise;
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    // Registered before the job turns 'running', so any cancel from then on
    // can reach the run.
    const controller = new AbortController();
    this.controllers.set(job.jobId, controller);

    let running: QueueJob | null = null;
    try {
      // Flip queued → running under the lock. From a stale read, a cancel that
      // landed in between was overwritten and the job ran anyway.
      const claimed = await this.withJobLockRetrying(job.jobId, async () => {
        const latest = await this.get(job.jobId);
        if (!latest || latest.status !== "queued") {
          return null;
        }
        const now = new Date();
        return this.updateJob(latest, {
          status: "running",
          startedAt: now.toISOString(),
          waitTimeMs: now.getTime() - new Date(latest.createdAt).getTime(),
          error: null
        });
      });
      running = claimed?.value ?? null;
    } finally {
      if (!running) {
        this.controllers.delete(job.jobId);
      }
    }
    if (!running) {
      return;
    }
    const startedAt = new Date(running.startedAt ?? Date.now());

    try {
      const result = await this.runner({
        jobId: running.jobId,
        task: running.task,
        cwd: running.cwd,
        dryRun: running.dryRun,
        resume: running.resume,
        workflowMode: running.workflowMode,
        workflowProfile: running.workflowProfile,
        approvalPolicy: running.approvalPolicy,
        approvalMode: running.approvalMode,
        externalTask: running.externalTask,
        signal: controller.signal
      });

      // Check if it was cancelled during execution
      if (controller.signal.aborted) {
        const finishedAt = new Date().toISOString();
        const executionTimeMs = new Date(finishedAt).getTime() - startedAt.getTime();
        await this.finishRun(running, () => ({
          status: "cancelled",
          finishedAt,
          executionTimeMs,
          resultSummary: "Job was aborted."
        }));
        return;
      }

      const status: QueueJobStatus = result.ok ? "completed" : "failed";
      const finishedAt = new Date().toISOString();
      const executionTimeMs = new Date(finishedAt).getTime() - startedAt.getTime();

      await this.finishRun(running, (current) => ({
        status,
        finishedAt,
        executionTimeMs,
        artifactPath: result.artifacts?.runPath ?? null,
        resultSummary: summarizeOrchestratorResult(result),
        error: result.ok ? null : (result.execution?.failure?.reason ?? "Run failed."),
        approvalPolicy: result.approvalPolicy ?? current.approvalPolicy,
        approvalMode: result.approvalPolicy?.approvalMode ?? current.approvalMode,
        approvalArtifact: current.approvalArtifact ?? null,
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
      }));
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const finishedAt = new Date().toISOString();
      const executionTimeMs = new Date(finishedAt).getTime() - startedAt.getTime();
      await this.finishRun(running, () => ({
        status: isAbort ? "cancelled" : "failed",
        finishedAt,
        executionTimeMs,
        error: (error as Error).message,
        resultSummary: isAbort ? "Job aborted." : "Job failed before producing a run result."
      }));
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
    await this.repository.write(job);
  }

  /**
   * Record an in-process run's final state unless the job finished meanwhile —
   * typically a cancel that landed after the run's abort check. Done under the
   * job lock so it is ordered against cancel(); if the lock stays busy,
   * recording the result unlocked beats dropping it.
   */
  private async finishRun(running: QueueJob, patch: (current: QueueJob) => Partial<QueueJob>): Promise<void> {
    const write = async () => {
      const current = (await this.get(running.jobId)) ?? running;
      if (FINISHED_STATUSES.has(current.status)) {
        return;
      }
      await this.updateJob(current, patch(current));
    };
    if (!(await this.withJobLockRetrying(running.jobId, write))) {
      this.options.logger?.warn(`Job ${running.jobId} stayed locked; recording its result without the lock.`);
      await write();
    }
  }

  private async withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T | null> {
    const lock = await this.repository.acquireLock(jobId);
    if (!lock) {
      return null;
    }
    try {
      return await fn();
    } finally {
      await lock.release().catch(() => {});
    }
  }

  /**
   * Like withJobLock, but rides out brief contention — a worker heartbeat
   * holds the lock for a moment — instead of failing at once. Resolves to null
   * only if the lock never came free.
   */
  private async withJobLockRetrying<T>(jobId: string, fn: () => Promise<T>): Promise<{ value: T } | null> {
    for (let attempt = 0; attempt < LOCK_RETRY_ATTEMPTS; attempt += 1) {
      const lock = await this.repository.acquireLock(jobId);
      if (lock) {
        try {
          return { value: await fn() };
        } finally {
          await lock.release().catch(() => {});
        }
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_BASE_DELAY_MS * (attempt + 1)));
    }
    return null;
  }

  private async cleanupOldJobs(): Promise<void> {
    try {
      // Only finished jobs are pruned. A queued job, a running one, or one
      // waiting days for approval is live work, however old or numerous.
      const all = (await this.list(500)).filter((job) => FINISHED_STATUSES.has(job.status));
      const retentionDays = this.options.retentionDays;

      if (retentionDays && retentionDays > 0) {
        const now = Date.now();
        const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
        const toDelete = all.filter((job) => now - new Date(job.createdAt).getTime() > maxAgeMs);

        for (const job of toDelete) {
          try {
            await this.delete(job.jobId);
          } catch {
            /* ignore */
          }
        }
        if (toDelete.length > 0) {
          this.options.logger?.info(`Cleaned up ${toDelete.length} old job record(s) based on retention policy (${retentionDays} days).`);
        }
        return;
      }

      if (all.length <= RETAINED_FINISHED_JOBS) return;

      const toDelete = all.slice(RETAINED_FINISHED_JOBS);
      for (const job of toDelete) {
        try {
          await this.delete(job.jobId);
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
