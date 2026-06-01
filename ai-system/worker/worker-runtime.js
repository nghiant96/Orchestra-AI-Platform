import { WorkerApiClient } from "./worker-client.js";
import { executeWorkerJob } from "./job-executor.js";
import { redactWorkerLogLine } from "./worker-safety.js";
export async function runWorkerRuntime(config, options = {}) {
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
    let activeJob = null;
    let claimedJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;
    let uploadedLogLines = 0;
    let stopped = false;
    const heartbeatTimer = setInterval(() => {
        void sendHeartbeat().catch((error) => {
            logger.warn(`Worker heartbeat failed: ${error.message}`);
            if (error.message.includes("lease")) {
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
            const logBuffer = [];
            const emitLog = (message) => {
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
                    markFilesystemMutation: async (stage, worktreePath) => {
                        const checkpoint = await retryTransientJobMutation(() => client.checkpoint(worker.id, job.jobId, lease.leaseId, {
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
                        }
                        else {
                            logger.warn(`Worker log upload failed: ${upload.error || "unknown error"}`);
                        }
                    }
                    catch (uploadError) {
                        logger.warn(`Worker log upload failed: ${uploadError.message}`);
                    }
                }
                if (result.ok) {
                    const completion = await retryTransientJobMutation(() => client.complete(worker.id, job.jobId, lease.leaseId, {
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
                }
                else {
                    const failure = await retryTransientJobMutation(() => client.fail(worker.id, job.jobId, lease.leaseId, result.summary, {
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
            }
            catch (error) {
                if (logBuffer.length > 0) {
                    try {
                        const upload = await client.uploadLogs(worker.id, job.jobId, lease.leaseId, logBuffer);
                        if (upload.ok) {
                            uploadedLogLines += logBuffer.length;
                        }
                    }
                    catch {
                        // best effort
                    }
                }
                const failureMessage = error instanceof Error ? error.message : "Worker job failed";
                const failure = await retryTransientJobMutation(() => client.fail(worker.id, job.jobId, lease.leaseId, failureMessage, {
                    workerLogs: logBuffer
                })).catch(() => ({ ok: false }));
                if (failure.ok) {
                    failedJobs += 1;
                }
                logger.error(`Worker job ${job.jobId} failed: ${failureMessage}`);
            }
            finally {
                activeJob = null;
                await sendHeartbeat("idle");
            }
            if (config.once) {
                break;
            }
        }
    }
    finally {
        clearInterval(heartbeatTimer);
        options.signal?.removeEventListener("abort", abortHandler);
        if (activeJob) {
            await sendHeartbeat("busy").catch(() => { });
        }
        else {
            await sendHeartbeat("idle").catch(() => { });
        }
    }
    return {
        worker,
        claimedJobs,
        completedJobs,
        failedJobs,
        uploadedLogLines
    };
    async function sendHeartbeat(status = activeJob ? "busy" : "idle") {
        const result = await retryTransientHeartbeat(async () => client.heartbeat(worker.id, {
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
    async function retryTransientHeartbeat(fn) {
        try {
            return await fn();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (message !== "Job is locked; retry") {
                throw error;
            }
            await sleep(25);
            return fn();
        }
    }
    async function retryTransientJobMutation(fn) {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                return await fn();
            }
            catch (error) {
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
    async function safeClaim() {
        try {
            const result = await client.claim(worker.id);
            return { job: result.job, lease: result.lease ? { leaseId: result.lease.leaseId } : null };
        }
        catch (error) {
            logger.warn(`Worker claim failed: ${error.message}`);
            return { job: null, lease: null };
        }
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function consoleLogger() {
    return {
        step(message) {
            console.log(message);
        },
        info(message) {
            console.log(message);
        },
        warn(message) {
            console.warn(message);
        },
        error(message) {
            console.error(message);
        },
        success(message) {
            console.log(message);
        }
    };
}
