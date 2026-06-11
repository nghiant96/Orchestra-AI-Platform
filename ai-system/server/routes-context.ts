import type http from "node:http";
import type { AuditLogRepository, AuditActor, AuditRole } from "../core/audit-log.js";
import type { FileBackedJobQueue } from "../core/job-queue.js";
import type { JobQueueRunInput } from "../core/job-queue.js";
import type { RulesConfig } from "../types.js";
import type { OrchestratorResult } from "../types.js";
import type { TokenRole } from "../security/token-policy.js";
import { canPerformAction } from "../core/permissions.js";
import type { ApprovalArtifactBinding } from "../approvals/approval-proof.js";

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
  auditLog: AuditLogRepository;
  pendingApprovals: Map<string, { resolve(value: boolean): void; type: "plan" | "checkpoint"; data?: unknown; binding?: ApprovalArtifactBinding }>;
  currentGlobalRules: RulesConfig | null;
  globalRulesPromise: Promise<{ rules: RulesConfig }>;
  actor: AuditActor;
  tokenRole: TokenRole;
  broadcastLog(level: string, message: string, jobId?: string): void;
  resolveRequestedCwd(value: unknown, defaultCwd: string, allowedRoots: string[]): Promise<string | null>;
  resolveOptionalRequestedCwd(value: unknown, defaultCwd: string, allowedRoots: string[]): Promise<string | null>;
  isAuthorized(req: http.IncomingMessage): boolean;
  respondJson(res: http.ServerResponse, statusCode: number, body: unknown): boolean;
}

export interface RouteHandler {
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean>;
}

export interface ActorRef {
  id: string;
  role: AuditRole;
  isAuthorized(action: string, rules: RulesConfig, projectId?: string): boolean;
}

export function createActorRef(actor: AuditActor): ActorRef {
  return {
    id: actor.id,
    role: actor.role,
    isAuthorized(action: string, rules: RulesConfig, projectId?: string): boolean {
      return canPerformAction(actor, rules, action, projectId);
    }
  };
}
