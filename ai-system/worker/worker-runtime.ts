import type { Logger } from "../types.js";
import type { QueueJob } from "../core/job-queue.js";
import type { Worker } from "../workers/worker-types.js";
import { WorkerApiClient } from "./worker-client.js";
import { executeWorkerJob, type WorkerJobExecutionContext, type WorkerJobExecutionResult } from "./job-executor.js";
import type { WorkerRuntimeConfig } from "./worker-config.js";
import { redactWorkerLogLine } from "./worker-safety.js";

export interface WorkerRuntimeOptions {
  logger?: Logger;
  signal?: AbortSignal;
  executor?: (context: WorkerJobExecutionContext) => Promise<WorkerJobExecutionResult>;
}

export interface WorkerRuntimeSummary {
  worker: Worker;
  claimedJobs: number;
  completedJobs: number;
  failedJobs: number;
  uploadedLogLines: number;
}

export async function runWorkerRuntime(
  config: WorkerRuntimeConfig,
  options: WorkerRuntimeOptions = {}
): Promise<WorkerRuntimeSummary> {
  const logger = options.logger ?? consoleLogger();
  const client = new WorkerApiClient({
    serverUrl: config.serverUrl,
    token: config.workerToken
  });

  const registration = await client.register({
    name: config.workerName,
    labels: config.labels,
    workspaceRoots: config.workspaceRoots,
    os: process.platform,
    arch: process.arch,
    version: "0.1.0"
  });
  const worker = registration.worker;

  let activeJob: { job: QueueJob; leaseId: string } | null = null;
  let claimedJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let uploadedLogLines = 0;
  let stopped = false;

  const heartbeatTimer = setInterval(() => {
    void sendHeartbeat().catch((error) => {
      logger.warn(`Worker heartbeat failed: ${(error as Error).message}`);
    });
  }, config.heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  const abortHandler = () => {
    stopped = true;
  };
  options.signal?.addEventListener("abort", abortHandler);

  try {
    await sendHeartbeat();

    while (!stopped) {
      if (options.signal?.aborted) {
        stopped = true;
        break;
      }

      const claim = await safeClaim();
      const job = claim.job;
      const lease = claim.lease;
      if (!job || !lease) {
        if (config.once) {
          break;
        }
        await sleep(config.pollIntervalMs);
        continue;
      }

      claimedJobs += 1;
      activeJob = { job, leaseId: lease.leaseId };
      await sendHeartbeat("busy");

      const logBuffer: string[] = [];
      const emitLog = (message: string) => {
        const redacted = redactWorkerLogLine(`[worker:${worker.id}] ${message}`);
        logBuffer.push(redacted);
        logger.info(redacted);
      };

      const runtimeExecutor = options.executor ?? executeWorkerJob;
      try {
        const result = await runtimeExecutor({
          client,
          worker,
          job,
          workspaceRoots: config.workspaceRoots,
          emitLog,
          markFilesystemMutation: async (stage: string, worktreePath?: string) => {
            const checkpoint = await client.checkpoint(worker.id, job.jobId, lease.leaseId, {
              stage,
              filesystemMutated: true,
              worktreePath
            });
            if (!checkpoint.ok) {
              throw new Error(checkpoint.error || "Failed to save checkpoint");
            }
          }
        });

        if (logBuffer.length > 0) {
          try {
            const upload = await client.uploadLogs(worker.id, job.jobId, lease.leaseId, logBuffer);
            if (upload.ok) {
              uploadedLogLines += logBuffer.length;
            } else {
              logger.warn(`Worker log upload failed: ${upload.error || "unknown error"}`);
            }
          } catch (uploadError) {
            logger.warn(`Worker log upload failed: ${(uploadError as Error).message}`);
          }
        }

        if (result.ok) {
          const completion = await client.complete(worker.id, job.jobId, lease.leaseId, {
            resultSummary: result.summary,
            workerLogs: logBuffer
          });
          if (!completion.ok) {
            throw new Error(completion.error || "Failed to complete job");
          }
          completedJobs += 1;
        } else {
          const failure = await client.fail(worker.id, job.jobId, lease.leaseId, result.summary, {
            workerLogs: logBuffer
          });
          if (!failure.ok) {
            throw new Error(failure.error || "Failed to fail job");
          }
          failedJobs += 1;
        }
      } catch (error) {
        if (logBuffer.length > 0) {
          try {
            const upload = await client.uploadLogs(worker.id, job.jobId, lease.leaseId, logBuffer);
            if (upload.ok) {
              uploadedLogLines += logBuffer.length;
            }
          } catch {
            // best effort
          }
        }
        const failureMessage = error instanceof Error ? error.message : "Worker job failed";
        const failure = await client.fail(worker.id, job.jobId, lease.leaseId, failureMessage, {
          workerLogs: logBuffer
        }).catch(() => ({ ok: false }));
        if ((failure as { ok: boolean }).ok) {
          failedJobs += 1;
        }
        logger.error(`Worker job ${job.jobId} failed: ${failureMessage}`);
      } finally {
        activeJob = null;
        await sendHeartbeat("idle");
      }

      if (config.once) {
        break;
      }
    }
  } finally {
    stopped = true;
    clearInterval(heartbeatTimer);
    options.signal?.removeEventListener("abort", abortHandler);
    if (activeJob) {
      await sendHeartbeat("busy").catch(() => {});
    } else {
      await sendHeartbeat("idle").catch(() => {});
    }
  }

  return {
    worker,
    claimedJobs,
    completedJobs,
    failedJobs,
    uploadedLogLines
  };

  async function sendHeartbeat(status: "idle" | "busy" = activeJob ? "busy" : "idle"): Promise<void> {
    const result = await client.heartbeat(worker.id, {
      status,
      currentJobId: activeJob?.job.jobId,
      leaseId: activeJob?.leaseId,
      jobId: activeJob?.job.jobId
    });
    if (!result.worker) {
      throw new Error("Heartbeat did not return worker state");
    }
  }

  async function safeClaim(): Promise<{ job: QueueJob | null; lease: { leaseId: string } | null }> {
    try {
      const result = await client.claim(worker.id);
      return { job: result.job, lease: result.lease ? { leaseId: result.lease.leaseId } : null };
    } catch (error) {
      logger.warn(`Worker claim failed: ${(error as Error).message}`);
      return { job: null, lease: null };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function consoleLogger(): Logger {
  return {
    step(message: string) {
      console.log(message);
    },
    info(message: string) {
      console.log(message);
    },
    warn(message: string) {
      console.warn(message);
    },
    error(message: string) {
      console.error(message);
    },
    success(message: string) {
      console.log(message);
    }
  };
}
