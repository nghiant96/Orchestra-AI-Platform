import path from "node:path";
import type { Worker, WorkerStatus } from "./worker-types.js";
import { WorkerStore } from "./worker-store.js";
import type { FileAuditLog, AuditActor } from "../core/audit-log.js";

export interface WorkerServiceContext {
  store: WorkerStore;
  auditLog: FileAuditLog;
  actor: AuditActor;
  allowedRoots: string[];
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
