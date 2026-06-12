import type { QueueJob } from "./job-queue.js";

export interface JobRecordLockHandle {
  release(): Promise<void>;
}

export interface JobRecordRepository {
  get(jobId: string): Promise<QueueJob | null>;
  list(limit?: number): Promise<QueueJob[]>;
  write(job: QueueJob): Promise<void>;
  delete(jobId: string): Promise<boolean>;
  migrateLegacyJobsFromDisk(): Promise<number>;
  acquireLock(jobId: string): Promise<JobRecordLockHandle | null>;
  close(): Promise<void>;
}
