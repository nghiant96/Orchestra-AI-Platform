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
      if ((error as Error).message.includes("lease")) {
        stopped = true;
      }
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
      const started = await client.start(worker.id, job.jobId, lease.leaseId);
      if (!started.ok) {
        throw new Error(started.error || "Failed to start worker job");
      }
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
          workspaceRoots: worker.workspaceRoots.length > 0 ? worker.workspaceRoots : config.workspaceRoots,
          providerId: config.provider,
          providerCommand: config.providerCommand,
          emitLog,
          markFilesystemMutation: async (stage: string, worktreePath?: string) => {
            const checkpoint = await retryWhileJobLocked(() => client.checkpoint(worker.id, job.jobId, lease.leaseId, {
              stage,
              filesystemMutated: true,
              worktreePath
            }));
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
          const completion = await retryWhileJobLocked(() => client.complete(worker.id, job.jobId, lease.leaseId, {
            resultSummary: result.summary,
            artifactPath: result.artifactPath,
            workerLogs: logBuffer,
            diffSummaries: result.diffSummaries,
            latestToolResults: result.latestToolResults,
            execution: result.execution
          }));
          if (!completion.ok) {
            throw new Error(completion.error || "Failed to complete job");
          }
          completedJobs += 1;
        } else {
          const failure = await retryWhileJobLocked(() => client.fail(worker.id, job.jobId, lease.leaseId, result.summary, {
            artifactPath: result.artifactPath,
            workerLogs: logBuffer,
            diffSummaries: result.diffSummaries,
            latestToolResults: result.latestToolResults,
            failure: result.failure,
            execution: result.execution
          }));
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
        const failure = await retryWhileJobLocked(() => client.fail(worker.id, job.jobId, lease.leaseId, failureMessage, {
          workerLogs: logBuffer
        })).catch(() => ({ ok: false }));
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
    const result = await retryWhileJobLocked(async () => client.heartbeat(worker.id, {
        status,
        currentJobId: activeJob?.job.jobId,
        leaseId: activeJob?.leaseId,
        jobId: activeJob?.job.jobId
      }));
    if (!result.worker) {
      throw new Error("Heartbeat did not return worker state");
    }
    if (status === "busy" && activeJob && result.leaseRenewed === false) {
      throw new Error(result.leaseError || "Worker lease renewal failed");
    }
  }

  /**
   * Losing a race for a job record lock is routine, not a fault: the server
   * serialises writers and tells the loser to come back. Every call that can
   * hit it therefore retries with a widening backoff.
   *
   * Heartbeats used to get a single retry at a fixed delay while mutations got
   * five. A heartbeat that lost twice threw out of the runtime loop and took
   * the whole worker down over transient contention, so both now share one
   * policy.
   */
  async function retryWhileJobLocked<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "";
        if (message !== "Job is locked; retry") {
          throw error;
        }
        await sleep(25 * (attempt + 1));
      }
    }
    throw lastError;
  }

  /**
   * Claim the next job, retrying a failed request before reporting an empty
   * queue.
   *
   * "Nothing to claim" and "the claim request failed" are indistinguishable to
   * the caller, and in `once` mode an empty claim ends the run. Collapsing a
   * transient failure into an empty result therefore made a one-shot worker
   * exit reporting success having done no work at all.
   */
  async function safeClaim(
    attempts = 3
  ): Promise<{ job: QueueJob | null; lease: { leaseId: string } | null }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await client.claim(worker.id);
        return { job: result.job, lease: result.lease ? { leaseId: result.lease.leaseId } : null };
      } catch (error) {
        lastError = error;
        logger.warn(
          `Worker claim attempt ${attempt + 1}/${attempts} failed: ${(error as Error).message}`
        );
        await sleep(50 * (attempt + 1));
      }
    }
    logger.error(
      `Worker claim gave up after ${attempts} attempts: ${(lastError as Error)?.message ?? "unknown error"}`
    );
    return { job: null, lease: null };
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
