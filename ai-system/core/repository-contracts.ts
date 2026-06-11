import type { AuditLogRepository } from "./audit-log.js";
import type { JobLease, JobQueueRunInput, QueueJob, QueueMutationResult, LeaseRenewResult } from "./job-queue.js";
import type { Worker } from "../workers/worker-types.js";

export interface JobRepository {
  enqueue(input: Omit<JobQueueRunInput, "jobId">): Promise<QueueJob>;
  get(jobId: string): Promise<QueueJob | null>;
  list(limit?: number): Promise<QueueJob[]>;
  cancel(jobId: string): Promise<QueueJob | null>;
  delete(jobId: string): Promise<boolean>;
  updateJob(job: QueueJob, patch: Partial<QueueJob>): Promise<QueueJob>;
  claimJob(jobId: string, lease: JobLease): Promise<QueueJob | null>;
  completeJob(jobId: string, leaseId: string, result: Partial<QueueJob>): Promise<QueueMutationResult>;
  failJob(jobId: string, leaseId: string, error: string, result?: Partial<QueueJob>): Promise<QueueMutationResult>;
  startJob(jobId: string, workerId: string, leaseId: string): Promise<QueueMutationResult>;
  renewLease(jobId: string, leaseId: string): Promise<LeaseRenewResult>;
  saveCheckpoint(jobId: string, leaseId: string, checkpoint: { stage: string; filesystemMutated: boolean; worktreePath?: string }): Promise<QueueMutationResult>;
  detectStaleLeases(): Promise<{ requeued: string[]; stalled: string[] }>;
  recoverStalledJob(jobId: string): Promise<QueueMutationResult>;
}

export interface WorkerRepository {
  create(worker: Partial<Worker> & Pick<Worker, "name">): Promise<Worker>;
  save(worker: Worker): Promise<void>;
  load(id: string): Promise<Worker | null>;
  list(): Promise<Worker[]>;
  delete(id: string): Promise<boolean>;
}

export type AuditRepository = AuditLogRepository;
