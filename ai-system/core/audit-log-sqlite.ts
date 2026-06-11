import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
// @ts-expect-error Node 24 exposes node:sqlite at runtime, but the pinned TS libs here do not declare it yet.
import { DatabaseSync } from "node:sqlite";
import type { AuditEvent, AuditLogRepository } from "./audit-log.js";
import { normalizeAuditEvent } from "./normalizers.js";

export class SqliteAuditLog implements AuditLogRepository {
  private db: DatabaseSync | null = null;

  constructor(private readonly filePath: string) {
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.ensureSchema();
  }

  setOnEvent(_callback: (event: AuditEvent) => void): void {
    // SQLite-backed logs are durable at write time; event streaming is not required here.
  }

  async append(event: Omit<AuditEvent, "id" | "timestamp" | "version">): Promise<AuditEvent> {
    const record: AuditEvent = {
      version: 1,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    const statement = this.db?.prepare("INSERT INTO audit_events (event_id, timestamp, record) VALUES (?, ?, ?)");
    statement?.run(record.id, record.timestamp, JSON.stringify(record));
    return record;
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT record FROM audit_events ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as Array<{ record?: string }>;
    return rows
      .map((row) => row.record ? normalizeAuditEvent(JSON.parse(row.record)) : null)
      .filter((event): event is AuditEvent => event !== null);
  }

  async runRetentionCleanup(days: number): Promise<number> {
    if (days <= 0 || !this.db) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare("DELETE FROM audit_events WHERE timestamp < ?").run(cutoff);
    return result.changes ?? 0;
  }

  async importLegacyJsonl(filePath: string): Promise<number> {
    if (!this.db) return 0;
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      return 0;
    }

    const records = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return normalizeAuditEvent(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((event): event is AuditEvent => event !== null);

    let imported = 0;
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO audit_events (event_id, timestamp, record) VALUES (?, ?, ?)"
    );
    for (const record of records) {
      const result = insert.run(record.id, record.timestamp, JSON.stringify(record));
      imported += Number(result.changes ?? 0);
    }
    return imported;
  }

  private ensureSchema(): void {
    this.db?.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
    `);
  }
}

export function resolveSqliteAuditLogPath(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "audit.sqlite");
}
