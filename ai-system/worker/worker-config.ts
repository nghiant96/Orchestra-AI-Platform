import os from "node:os";
import path from "node:path";
import { parseCsvList, normalizeWorkspaceRoots } from "./worker-safety.js";

export interface WorkerRuntimeConfig {
  serverUrl: string;
  workerToken: string;
  workerName: string;
  labels: string[];
  workspaceRoots: string[];
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
  once: boolean;
  cwd: string;
  provider: string;
  providerCommand?: string;
}

export interface WorkerRuntimeConfigInput {
  cwd: string;
  serverUrl?: string;
  workerToken?: string;
  workerName?: string;
  labels?: string[];
  workspaceRoots?: string[];
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  once?: boolean;
  provider?: string;
  providerCommand?: string;
}

export function loadWorkerRuntimeConfig(input: WorkerRuntimeConfigInput): WorkerRuntimeConfig {
  const cwd = path.resolve(input.cwd);
  const serverUrl = normalizeUrl(input.serverUrl ?? process.env.ORCHESTRA_SERVER_URL ?? "http://127.0.0.1:3927");
  const workerToken = String(input.workerToken ?? process.env.ORCHESTRA_WORKER_TOKEN ?? "").trim();
  if (!workerToken) {
    throw new Error("ORCHESTRA_WORKER_TOKEN is required for worker start.");
  }

  const workerName =
    String(input.workerName ?? process.env.ORCHESTRA_WORKER_NAME ?? "").trim() ||
    defaultWorkerName();

  const labels = uniqueStrings([
    ...parseCsvList(process.env.ORCHESTRA_WORKER_LABELS),
    ...(input.labels ?? [])
  ]);

  const workspaceRootsSource = uniqueStrings([
    ...parseCsvList(process.env.ORCHESTRA_WORKSPACE_ROOTS),
    ...(input.workspaceRoots ?? [])
  ]);
  const workspaceRoots = normalizeWorkspaceRoots(workspaceRootsSource.length > 0 ? workspaceRootsSource : [cwd], cwd);

  return {
    serverUrl,
    workerToken,
    workerName,
    labels,
    workspaceRoots,
    heartbeatIntervalMs: sanitizeInterval(input.heartbeatIntervalMs ?? envNumber("ORCHESTRA_WORKER_HEARTBEAT_INTERVAL_MS"), 10_000),
    pollIntervalMs: sanitizeInterval(input.pollIntervalMs ?? envNumber("ORCHESTRA_WORKER_POLL_INTERVAL_MS"), 2_000),
    once: Boolean(input.once ?? envBool("ORCHESTRA_WORKER_ONCE")),
    cwd,
    provider: String(input.provider ?? process.env.ORCHESTRA_WORKER_PROVIDER ?? "codex").trim().toLowerCase(),
    providerCommand: input.providerCommand ?? process.env.ORCHESTRA_CODEX_COMMAND
  };
}

function defaultWorkerName(): string {
  return `${os.hostname() || "worker"}-${process.pid}`;
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function envBool(name: string): boolean | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function sanitizeInterval(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.max(100, Math.floor(value as number)) : fallback;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
