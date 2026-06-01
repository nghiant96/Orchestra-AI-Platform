import fs from "node:fs/promises";
import path from "node:path";
import { normalizeQueueJob } from "./normalizers.js";
import { scheduleWorkItems } from "../work/scheduler.js";
export class FileBackedJobQueue {
    jobsDir;
    runner;
    options;
    activeJobs = 0;
    drainTimer = null;
    controllers = new Map();
    activeWorkspaces = new Set();
    activeRunPromises = new Set();
    isPaused = false;
    isStopped = false;
    constructor(jobsDir, runner, options = {}) {
        this.jobsDir = jobsDir;
        this.runner = runner;
        this.options = options;
    }
    setPaused(paused) {
        this.isPaused = paused;
        if (!paused && !this.isStopped) {
            this.scheduleDrain();
        }
    }
    getPaused() {
        return this.isPaused;
    }
    setRetentionDays(days) {
        this.options.retentionDays = days;
    }
    async enqueue(input) {
        const now = new Date().toISOString();
        const job = {
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
    /**
     * Enqueue work items in batch, running them through the scheduler first.
     * Only ready items are enqueued; blocked items are logged and skipped.
     * Returns the scheduler plan for diagnostics.
     */
    async enqueueBatch(workItems, baseInput, schedulerOptions = {}) {
        const plan = scheduleWorkItems(workItems, schedulerOptions);
        if (plan.blocked.length > 0) {
            this.options.logger?.info(`Scheduler blocked ${plan.blocked.length} work item(s): ${plan.blocked
                .map((b) => `${b.workItem.id} (${b.conflicts.map((c) => c.reason).join("; ")})`)
                .join(", ")}`);
        }
        const jobs = [];
        for (const item of plan.ready) {
            const job = await this.enqueue({
                task: `[${item.id}] ${item.title}`,
                cwd: baseInput.cwd,
                dryRun: baseInput.dryRun,
                resume: baseInput.resume,
                workflowMode: baseInput.workflowMode,
                workflowProfile: baseInput.workflowProfile,
                approvalMode: baseInput.approvalMode,
                approvalPolicy: baseInput.approvalPolicy,
                externalTask: item.externalTask ?? baseInput.externalTask
            });
            jobs.push(job);
        }
        return { plan, jobs };
    }
    async get(jobId) {
        if (!isSafeJobId(jobId)) {
            return null;
        }
        try {
            const raw = await fs.readFile(this.jobPath(jobId), "utf8");
            return normalizeQueueJob(JSON.parse(raw));
        }
        catch {
            return null;
        }
    }
    async list(limit = 50) {
        await fs.mkdir(this.jobsDir, { recursive: true });
        let entries;
        try {
            entries = await fs.readdir(this.jobsDir);
        }
        catch {
            return [];
        }
        const jobs = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => this.get(entry.replace(/\.json$/, ""))));
        return jobs
            .filter((job) => job !== null)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, limit);
    }
    async cancel(jobId) {
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
    async delete(jobId) {
        if (!isSafeJobId(jobId)) {
            return false;
        }
        try {
            await fs.unlink(this.jobPath(jobId));
            return true;
        }
        catch {
            return false;
        }
    }
    async runRetentionCleanup() {
        await this.cleanupOldJobs();
    }
    async claimJob(jobId, lease) {
        if (!isSafeJobId(jobId))
            return null;
        return this.withJobLock(jobId, async () => {
            const job = await this.get(jobId);
            if (!job)
                return null;
            if (job.status !== "queued")
                return null;
            const now = Date.now();
            if (job.lease && new Date(job.lease.expiresAt).getTime() > now) {
                return null;
            }
            const updated = {
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
    async completeJob(jobId, leaseId, result) {
        const job = await this.get(jobId);
        if (!job)
            return { ok: false, error: "Job not found" };
        if (!job.lease)
            return { ok: false, error: "No active lease" };
        if (job.lease.leaseId !== leaseId) {
            if (job.status === "completed" || job.status === "failed") {
                return { ok: true };
            }
            return { ok: false, error: "Invalid leaseId" };
        }
        if (job.status === "completed" || job.status === "failed") {
            return { ok: true };
        }
        const now = Date.now();
        if (new Date(job.lease.expiresAt).getTime() < now) {
            return { ok: false, error: "Lease expired" };
        }
        const finishedAt = new Date().toISOString();
        const startedAt = job.startedAt ? new Date(job.startedAt) : new Date(finishedAt);
        const updated = {
            ...job,
            ...result,
            status: "completed",
            finishedAt,
            executionTimeMs: new Date(finishedAt).getTime() - startedAt.getTime(),
            updatedAt: finishedAt
        };
        await this.writeJob(updated);
        return { ok: true };
    }
    async failJob(jobId, leaseId, error, result = {}) {
        const job = await this.get(jobId);
        if (!job)
            return { ok: false, error: "Job not found" };
        if (!job.lease)
            return { ok: false, error: "No active lease" };
        if (job.lease.leaseId !== leaseId) {
            if (job.status === "completed" || job.status === "failed") {
                return { ok: true };
            }
            return { ok: false, error: "Invalid leaseId" };
        }
        if (job.status === "completed" || job.status === "failed") {
            return { ok: true };
        }
        const now = Date.now();
        if (new Date(job.lease.expiresAt).getTime() < now) {
            return { ok: false, error: "Lease expired" };
        }
        const finishedAt = new Date().toISOString();
        const startedAt = job.startedAt ? new Date(job.startedAt) : new Date(finishedAt);
        const updated = {
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
    }
    async renewLease(jobId, leaseId) {
        const job = await this.get(jobId);
        if (!job || !job.lease)
            return null;
        if (job.lease.leaseId !== leaseId)
            return null;
        const now = new Date();
        const updated = {
            ...job.lease,
            lastHeartbeatAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString()
        };
        const updatedJob = {
            ...job,
            lease: updated,
            updatedAt: now.toISOString()
        };
        await this.writeJob(updatedJob);
        return updated;
    }
    async saveCheckpoint(jobId, leaseId, checkpoint) {
        const job = await this.get(jobId);
        if (!job)
            return { ok: false, error: "Job not found" };
        if (!job.lease || job.lease.leaseId !== leaseId)
            return { ok: false, error: "Invalid leaseId" };
        const checkpointRecord = {
            jobId,
            leaseId,
            stage: checkpoint.stage,
            filesystemMutated: checkpoint.filesystemMutated,
            worktreePath: checkpoint.worktreePath,
            timestamp: new Date().toISOString()
        };
        const updated = {
            ...job,
            mutationCheckpoint: checkpointRecord,
            updatedAt: new Date().toISOString()
        };
        await this.writeJob(updated);
        return { ok: true };
    }
    async detectStaleLeases() {
        const now = Date.now();
        const all = await this.list(200);
        const requeued = [];
        const stalled = [];
        for (const job of all) {
            if (!job.lease)
                continue;
            if (new Date(job.lease.expiresAt).getTime() > now)
                continue;
            if (job.status !== "assigned" && job.status !== "running" && job.status !== "waiting_for_approval")
                continue;
            const hasMutatedFilesystem = job.mutationCheckpoint?.filesystemMutated === true;
            if (hasMutatedFilesystem) {
                await this.updateJob(job, {
                    status: "stalled",
                    updatedAt: new Date().toISOString()
                });
                stalled.push(job.jobId);
            }
            else {
                await this.updateJob(job, {
                    status: "queued",
                    lease: undefined,
                    workerId: undefined,
                    mutationCheckpoint: undefined,
                    updatedAt: new Date().toISOString()
                });
                requeued.push(job.jobId);
            }
        }
        return { requeued, stalled };
    }
    async recoverStalledJob(jobId) {
        const job = await this.get(jobId);
        if (!job)
            return { ok: false, error: "Job not found" };
        if (job.status !== "stalled")
            return { ok: false, error: "Job is not stalled" };
        await this.updateJob(job, {
            status: "queued",
            lease: undefined,
            workerId: undefined,
            mutationCheckpoint: undefined,
            attempt: (job.attempt ?? 0) + 1,
            updatedAt: new Date().toISOString()
        });
        return { ok: true };
    }
    start() {
        this.isStopped = false;
        this.scheduleDrain();
        this.cleanupHungJobs();
    }
    async stop() {
        this.isStopped = true;
        if (this.drainTimer) {
            clearTimeout(this.drainTimer);
            this.drainTimer = null;
        }
        await Promise.allSettled([...this.activeRunPromises]);
    }
    async cleanupHungJobs() {
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
    scheduleDrain() {
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
    async drain() {
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
    async runJob(job) {
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
                await this.updateJob(running, {
                    status: "cancelled",
                    finishedAt,
                    executionTimeMs,
                    resultSummary: "Job was aborted."
                });
                return;
            }
            const current = (await this.get(running.jobId)) ?? running;
            const status = result.ok ? "completed" : "failed";
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
            });
        }
        catch (error) {
            const isAbort = error instanceof Error && error.name === "AbortError";
            const finishedAt = new Date().toISOString();
            const executionTimeMs = new Date(finishedAt).getTime() - startedAt.getTime();
            await this.updateJob(running, {
                status: isAbort ? "cancelled" : "failed",
                finishedAt,
                executionTimeMs,
                error: error.message,
                resultSummary: isAbort ? "Job aborted." : "Job failed before producing a run result."
            });
            this.options.logger?.error(`Queued job ${running.jobId} ${isAbort ? "aborted" : "failed"}: ${error.message}`);
        }
        finally {
            this.controllers.delete(job.jobId);
        }
    }
    async updateJob(job, patch) {
        const updated = {
            ...job,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        await this.writeJob(updated);
        return updated;
    }
    async writeJob(job) {
        await fs.mkdir(this.jobsDir, { recursive: true });
        const targetPath = this.jobPath(job.jobId);
        const tempPath = `${targetPath}.tmp.${Date.now()}`;
        await fs.writeFile(tempPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
        await fs.rename(tempPath, targetPath);
    }
    jobPath(jobId) {
        return path.join(this.jobsDir, `${jobId}.json`);
    }
    async withJobLock(jobId, fn) {
        const lock = await this.acquireJobLock(jobId);
        if (!lock) {
            return null;
        }
        try {
            return await fn();
        }
        finally {
            await lock.close().catch(() => { });
            await fs.unlink(this.lockPath(jobId)).catch(() => { });
        }
    }
    async acquireJobLock(jobId) {
        await fs.mkdir(this.jobsDir, { recursive: true });
        const lockPath = this.lockPath(jobId);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const handle = await fs.open(lockPath, "wx");
                await handle.writeFile(`${process.pid}:${Date.now()}\n`, "utf8");
                return handle;
            }
            catch (err) {
                if (err.code !== "EEXIST") {
                    throw err;
                }
                const stat = await fs.stat(lockPath).catch(() => null);
                if (stat && Date.now() - stat.mtimeMs > 30_000) {
                    await fs.unlink(lockPath).catch(() => { });
                    continue;
                }
                return null;
            }
        }
        return null;
    }
    lockPath(jobId) {
        return `${this.jobPath(jobId)}.lock`;
    }
    async cleanupOldJobs() {
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
                    }
                    catch {
                        /* ignore */
                    }
                }
                if (toDelete.length > 0) {
                    this.options.logger?.info(`Cleaned up ${toDelete.length} old job record(s) based on retention policy (${retentionDays} days).`);
                }
                return;
            }
            if (all.length <= 100)
                return;
            const toDelete = all.slice(100);
            for (const job of toDelete) {
                try {
                    await fs.unlink(this.jobPath(job.jobId));
                }
                catch {
                    /* ignore */
                }
            }
            this.options.logger?.info(`Cleaned up ${toDelete.length} old job records.`);
        }
        catch (err) {
            this.options.logger?.warn(`Failed to cleanup old jobs: ${err.message}`);
        }
    }
}
export function resolveJobQueueDirectory(defaultCwd) {
    return path.join(defaultCwd, ".ai-system-server", "jobs");
}
function createJobId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function isSafeJobId(jobId) {
    return /^[a-z0-9-]+$/i.test(jobId);
}
function summarizeOrchestratorResult(result) {
    if (result.result?.summary) {
        return result.result.summary;
    }
    if (result.status) {
        return `Run ${result.status}.`;
    }
    return result.ok ? "Run completed." : "Run failed.";
}
