import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAuditEvent } from "./normalizers.js";

export type AuditRole = "viewer" | "operator" | "admin";

export interface AuditActor {
  id: string;
  role: AuditRole;
  /** Highest role the request's credential allows. Set only when it is below admin. */
  maxRole?: AuditRole;
}

const ROLE_RANK: Record<AuditRole, number> = { viewer: 0, operator: 1, admin: 2 };

export interface AuditLogRepository {
  setOnEvent(callback: (event: AuditEvent) => void): void;
  append(event: Omit<AuditEvent, "id" | "timestamp" | "version">): Promise<AuditEvent>;
  list(limit?: number): Promise<AuditEvent[]>;
  runRetentionCleanup(days: number): Promise<number>;
}

export interface AuditEvent {
  version: number;
  id: string;
  timestamp: string;
  action: string;
  actor: AuditActor;
  cwd?: string;
  jobId?: string;
  details?: Record<string, unknown>;
}

export class FileAuditLog implements AuditLogRepository {
  private onEventCallback?: (event: AuditEvent) => void;

  constructor(private readonly filePath: string) {}

  setOnEvent(callback: (event: AuditEvent) => void): void {
    this.onEventCallback = callback;
  }

  async append(event: Omit<AuditEvent, "id" | "timestamp" | "version">): Promise<AuditEvent> {
    const record: AuditEvent = {
      version: 1,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");

    if (this.onEventCallback) {
      this.onEventCallback(record);
    }

    return record;
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => normalizeAuditEvent(JSON.parse(line)))
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async runRetentionCleanup(days: number): Promise<number> {
    if (days <= 0) return 0;
    try {
      const events = await this.list(10000);
      const now = Date.now();
      const maxAgeMs = days * 24 * 60 * 60 * 1000;
      const filtered = events.filter((e) => now - new Date(e.timestamp).getTime() <= maxAgeMs);

      if (filtered.length === events.length) {
        return 0;
      }

      const content = filtered
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .map((e) => JSON.stringify(e))
        .join("\n") + (filtered.length > 0 ? "\n" : "");

      await fs.writeFile(this.filePath, content, "utf8");
      return events.length - filtered.length;
    } catch {
      return 0;
    }
  }
}

export function resolveAuditLogPath(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "audit.jsonl");
}

export function parseAuditActor(
  headers: { [key: string]: string | string[] | undefined },
  rules?: import("../types.js").RulesConfig
): AuditActor {
  const actorId = firstHeader(headers["x-ai-system-actor"]) || "dashboard";
  const roleHeader = firstHeader(headers["x-ai-system-role"]);

  // 1. Check for explicit mapping in rules
  if (rules?.auth?.role_mapping?.[actorId]) {
    return { id: actorId, role: rules.auth.role_mapping[actorId] };
  }

  // 2. Fallback to header or default
  const role: AuditRole = roleHeader === "admin" || roleHeader === "operator" || roleHeader === "viewer"
    ? roleHeader
    : "viewer";

  return {
    id: actorId,
    role
  };
}

export function roleCan(actor: AuditActor, required: AuditRole): boolean {
  return ROLE_RANK[actor.role] >= ROLE_RANK[required];
}

/**
 * Clamp an actor to the highest role its credential allows. The actor and role
 * headers are asserted by the client, so they may lower privilege but never
 * raise it past what the token grants.
 */
export function capActorRole(actor: AuditActor, maxRole: AuditRole | undefined): AuditActor {
  if (!maxRole) return actor;
  const role = ROLE_RANK[actor.role] > ROLE_RANK[maxRole] ? maxRole : actor.role;
  return { ...actor, role, maxRole };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
