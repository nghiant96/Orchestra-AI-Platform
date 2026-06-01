import path from "node:path";
import fs from "node:fs/promises";
import type { Worker, WorkerStatus } from "./worker-types.js";
import { WorkerStore } from "./worker-store.js";
import type { FileAuditLog, AuditActor } from "../core/audit-log.js";
import type { FileBackedJobQueue, QueueJob, JobLease } from "../core/job-queue.js";
import { resolveExecutionBackend } from "../core/execution-backend.js";

export interface WorkerServiceContext {
  store: WorkerStore;
  auditLog: FileAuditLog;
  actor: AuditActor;
  allowedRoots: string[];
}

export interface WorkerServiceExtendedContext extends WorkerServiceContext {
  queue: FileBackedJobQueue;
}

export interface RegisterWorkerInput {
  name: string;
  version?: string;
  os?: string;
  arch?: string;
  labels?: string[];
  capabilities?: Worker["capabilities"];
  workspaceRoots?: string[];
}

export interface HeartbeatInput {
  status?: unknown;
  currentJobId?: string;
  freeDiskGb?: number;
  cpuLoad?: number;
}

export class WorkerServiceError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "WorkerServiceError";
  }
}

export async function registerWorker(
  ctx: WorkerServiceContext,
  input: RegisterWorkerInput
): Promise<Worker> {
  if (!input.name || !input.name.trim()) {
    throw new WorkerServiceError("Worker name is required", 400);
  }

  const os = input.os || process.platform;
  if (!["darwin", "linux", "windows"].includes(os)) {
    throw new WorkerServiceError(`Unsupported OS: ${os}`, 400);
  }

  const workspaceRoots = input.workspaceRoots || [];
  for (const root of workspaceRoots) {
    if (!isPathWithinAllowedRoots(root, ctx.allowedRoots)) {
      throw new WorkerServiceError(`Workspace root not in allowed workdirs: ${root}`, 403);
    }
  }

  const worker = await ctx.store.create({
    name: input.name.trim(),
    version: input.version || "0.1.0",
    os,
    arch: input.arch || process.arch,
    labels: input.labels || [],
    capabilities: input.capabilities || {},
    workspaceRoots,
    status: "online",
    lastHeartbeatAt: new Date().toISOString()
  });

  await ctx.auditLog.append({
    actor: ctx.actor,
    action: "worker.register",
    details: {
      workerId: worker.id,
      workerName: worker.name,
      os: worker.os,
      arch: worker.arch
    }
  });

  return worker;
}

export async function updateHeartbeat(
  ctx: WorkerServiceContext,
  workerId: string,
  input: HeartbeatInput
): Promise<Worker> {
  const worker = await ctx.store.load(workerId);
  if (!worker) {
    throw new WorkerServiceError("Worker not found", 404);
  }

  const previousStatus = worker.status;
  const parsedStatus = input.status === undefined ? null : normalizeWorkerStatus(input.status);
  if (input.status !== undefined && !parsedStatus) {
    throw new WorkerServiceError(`Invalid worker status: ${String(input.status)}`, 400);
  }
  const newStatus = parsedStatus ?? "idle";

  const updated: Worker = {
    ...worker,
    status: newStatus,
    currentJobId: input.currentJobId ?? worker.currentJobId,
    freeDiskGb: input.freeDiskGb ?? worker.freeDiskGb,
    cpuLoad: input.cpuLoad ?? worker.cpuLoad,
    lastHeartbeatAt: new Date().toISOString()
  };

  await ctx.store.save(updated);

  if (previousStatus !== newStatus) {
    await ctx.auditLog.append({
      actor: ctx.actor,
      action: "worker.status_change",
      details: {
        workerId,
        previousStatus,
        newStatus,
        currentJobId: updated.currentJobId ?? null
      }
    });
  }

  return updated;
}

export async function setWorkerStatus(
  ctx: WorkerServiceContext,
  workerId: string,
  action: "disable" | "enable" | "drain"
): Promise<Worker> {
  const worker = await ctx.store.load(workerId);
  if (!worker) {
    throw new WorkerServiceError("Worker not found", 404);
  }

  let newStatus: WorkerStatus;
  switch (action) {
    case "disable":
      newStatus = "disabled";
      break;
    case "enable":
      newStatus = "idle";
      break;
    case "drain":
      newStatus = "draining";
      break;
  }

  const updated: Worker = { ...worker, status: newStatus };
  await ctx.store.save(updated);

  await ctx.auditLog.append({
    actor: ctx.actor,
    action: `worker.${action}`,
    details: { workerId, previousStatus: worker.status }
  });

  return updated;
}

export async function listWorkers(ctx: WorkerServiceContext): Promise<Worker[]> {
  return ctx.store.list();
}

export async function getWorker(ctx: WorkerServiceContext, workerId: string): Promise<Worker | null> {
  return ctx.store.load(workerId);
}

export interface ClaimResult {
  job: QueueJob | null;
  lease: JobLease | null;
  retryAfterMs?: number;
  rejectionReason?: string;
}

export async function claimJob(ctx: WorkerServiceExtendedContext, workerId: string): Promise<ClaimResult> {
  const backend = resolveExecutionBackend();
  if (backend === "in-process") {
    return { job: null, lease: null, rejectionReason: "Execution backend is in-process. External workers cannot claim jobs." };
  }

  const worker = await ctx.store.load(workerId);
  if (!worker) {
    return { job: null, lease: null, rejectionReason: "Worker not found" };
  }

  if (worker.status !== "idle" && worker.status !== "online") {
    return { job: null, lease: null, rejectionReason: `Worker status is ${worker.status}, not idle or online` };
  }

  const MAX_ATTEMPTS = 3;
  const jobs = await ctx.queue.list(100);
  const activeLeaseJobIds = new Set(
    jobs.filter((j) => j.lease && new Date(j.lease.expiresAt).getTime() > Date.now()).map((j) => j.jobId)
  );

  for (const job of jobs) {
    if (job.status !== "queued") continue;
    if (job.lease && new Date(job.lease.expiresAt).getTime() > Date.now()) continue;

    const currentAttempt = job.attempt ?? 0;
    if (currentAttempt >= MAX_ATTEMPTS) continue;

    if (!workerMatchesJobSelector(worker, job)) continue;
    if (!(await isPathWithinWorkspaceRoots(job.cwd, worker.workspaceRoots))) continue;

    const now = new Date();
    const lease: JobLease = {
      workerId,
      leaseId: createLeaseId(),
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      lastHeartbeatAt: now.toISOString()
    };

    const claimed = await ctx.queue.claimJob(job.jobId, lease);
    if (!claimed) continue;

    await ctx.store.save({
      ...worker,
      status: "busy",
      currentJobId: job.jobId
    });

    await ctx.auditLog.append({
      actor: ctx.actor,
      action: "worker.claim",
      details: { workerId, jobId: job.jobId, leaseId: lease.leaseId }
    });

    return { job: claimed, lease };
  }

  return {
    job: null,
    lease: null,
    retryAfterMs: 3000,
    rejectionReason: activeLeaseJobIds.size > 0 ? "All queued jobs have active leases" : "No matching jobs available"
  };
}

export async function completeJob(
  ctx: WorkerServiceExtendedContext,
  workerId: string,
  jobId: string,
  leaseId: string,
  result?: Partial<QueueJob>
): Promise<{ ok: boolean; error?: string }> {
  const r = await ctx.queue.completeJob(jobId, leaseId, result || {});

  if (r.ok) {
    const worker = await ctx.store.load(workerId);
    if (worker) {
      await ctx.store.save({ ...worker, status: "idle", currentJobId: undefined });
    }
    await ctx.auditLog.append({
      actor: ctx.actor,
      action: "worker.complete",
      details: { workerId, jobId, leaseId }
    });
  }

  return r;
}

export async function failJob(
  ctx: WorkerServiceExtendedContext,
  workerId: string,
  jobId: string,
  leaseId: string,
  errorMessage: string,
  result?: Partial<QueueJob>
): Promise<{ ok: boolean; error?: string }> {
  const r = await ctx.queue.failJob(jobId, leaseId, errorMessage, result || {});

  if (r.ok) {
    const worker = await ctx.store.load(workerId);
    if (worker) {
      await ctx.store.save({ ...worker, status: "idle", currentJobId: undefined });
    }
    await ctx.auditLog.append({
      actor: ctx.actor,
      action: "worker.fail",
      details: { workerId, jobId, leaseId, error: errorMessage }
    });
  }

  return r;
}

export function normalizeWorkerStatus(value: unknown): WorkerStatus | null {
  return value === "online" || value === "idle" || value === "busy" || value === "draining" || value === "disabled" || value === "offline"
    ? value
    : null;
}

function isPathWithinAllowedRoots(candidate: string, allowedRoots: string[]): boolean {
  if (allowedRoots.length === 0) return true;
  const resolvedCandidate = path.resolve(candidate);
  return allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
  });
}

async function isPathWithinWorkspaceRoots(candidate: string, roots: string[]): Promise<boolean> {
  if (roots.length === 0) return true;
  const resolvedCandidate = await resolveComparablePath(candidate);
  if (!resolvedCandidate) return false;
  for (const root of roots) {
    const resolvedRoot = await resolveComparablePath(root);
    if (!resolvedRoot) continue;
    if (resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
      return true;
    }
  }
  return false;
}

function workerMatchesJobSelector(worker: Worker, job: QueueJob): boolean {
  const selector = job.workerSelector;
  if (selector?.os && selector.os !== worker.os) {
    return false;
  }

  if (selector?.labels?.length) {
    const workerLabels = new Set(worker.labels);
    for (const label of selector.labels) {
      if (!workerLabels.has(label)) {
        return false;
      }
    }
  }

  const requiredCapabilities = job.requiredCapabilities;
  if (requiredCapabilities) {
    for (const [key, value] of Object.entries(requiredCapabilities)) {
      if (value === undefined) continue;
      if ((worker.capabilities as Record<string, unknown>)[key] !== value) {
        return false;
      }
    }
  }

  return true;
}

async function resolveComparablePath(candidate: string): Promise<string | null> {
  try {
    return await fs.realpath(candidate);
  } catch {
    try {
      return path.resolve(candidate);
    } catch {
      return null;
    }
  }
}

function createLeaseId(): string {
  return `lease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
