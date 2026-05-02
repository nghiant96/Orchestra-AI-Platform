import type http from "node:http";
import type { FileAuditLog } from "../core/audit-log.js";
import type { FileBackedJobQueue } from "../core/job-queue.js";
import type { JobQueueRunInput } from "../core/job-queue.js";
import type { RulesConfig } from "../types.js";
import type { OrchestratorResult } from "../types.js";
import type { AuditActor } from "../core/audit-log.js";

export interface ServerRouteContext {
  defaultCwd: string;
  allowedRoots: string[];
  options: {
    authToken?: string;
    queueConcurrency?: number;
    logger: { info(message: string): void; warn(message: string): void };
  };
  queue: FileBackedJobQueue;
  runNow(input: JobQueueRunInput): Promise<OrchestratorResult>;
  auditLog: FileAuditLog;
  pendingApprovals: Map<string, { resolve(value: boolean): void; type: "plan" | "checkpoint"; data?: unknown }>;
  currentGlobalRules: RulesConfig | null;
  globalRulesPromise: Promise<{ rules: RulesConfig }>;
  actor: AuditActor;
  broadcastLog(level: string, message: string, jobId?: string): void;
  resolveRequestedCwd(value: unknown, defaultCwd: string, allowedRoots: string[]): string | null;
  resolveOptionalRequestedCwd(value: unknown, defaultCwd: string, allowedRoots: string[]): string | null;
  isAuthorized(req: http.IncomingMessage): boolean;
  respondJson(res: http.ServerResponse, statusCode: number, body: unknown): boolean;
}

export interface RouteHandler {
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean>;
}
