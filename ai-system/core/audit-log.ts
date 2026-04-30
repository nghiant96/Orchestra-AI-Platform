import fs from "node:fs/promises";
import path from "node:path";

export type AuditRole = "viewer" | "operator" | "admin";

export interface AuditActor {
  id: string;
  role: AuditRole;
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

export class FileAuditLog {
  constructor(private readonly filePath: string) {}

  async append(event: Omit<AuditEvent, "id" | "timestamp" | "version">): Promise<AuditEvent> {
    const record: AuditEvent = {
      version: 1,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEvent)
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

export function parseAuditActor(headers: { [key: string]: string | string[] | undefined }): AuditActor {
  const roleHeader = firstHeader(headers["x-ai-system-role"]);
  const role: AuditRole = roleHeader === "viewer" || roleHeader === "operator" || roleHeader === "admin"
    ? roleHeader
    : "admin";
  return {
    id: firstHeader(headers["x-ai-system-actor"]) || "dashboard",
    role
  };
}

export function roleCan(actor: AuditActor, required: AuditRole): boolean {
  const rank: Record<AuditRole, number> = { viewer: 0, operator: 1, admin: 2 };
  return rank[actor.role] >= rank[required];
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
