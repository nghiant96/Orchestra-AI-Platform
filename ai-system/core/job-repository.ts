import type { QueueJob } from "./job-queue.js";

export interface JobRecordRepository {
  get(jobId: string): Promise<QueueJob | null>;
  list(limit?: number): Promise<QueueJob[]>;
  write(job: QueueJob): Promise<void>;
  delete(jobId: string): Promise<boolean>;
  migrateLegacyJobsFromDisk(): Promise<number>;
  close(): Promise<void>;
}
