import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { normalizeAuditEvent } from "./normalizers.js";
import type { AuditEvent, AuditLogRepository } from "./audit-log.js";
import { withPostgresClient } from "./postgres.js";

export class PostgresAuditLog implements AuditLogRepository {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  setOnEvent(_callback: (event: AuditEvent) => void): void {
    // Postgres-backed logs are durable at write time; event streaming is not required here.
  }

  async append(event: Omit<AuditEvent, "id" | "timestamp" | "version">): Promise<AuditEvent> {
    await this.ensureSchemaReady();
    const record: AuditEvent = {
      version: 1,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    await withPostgresClient(this.pool, async (client) => {
      await client.query(
        "INSERT INTO audit_events (event_id, timestamp, record) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO UPDATE SET timestamp = EXCLUDED.timestamp, record = EXCLUDED.record",
        [record.id, record.timestamp, JSON.stringify(record)]
      );
    });
    return record;
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    await this.ensureSchemaReady();
    return await withPostgresClient(this.pool, async (client) => {
      const result = await client.query<{ record: string }>(
        "SELECT record FROM audit_events ORDER BY timestamp DESC LIMIT $1",
        [limit]
      );
      return result.rows
        .map((row) => {
          try {
            return normalizeAuditEvent(JSON.parse(row.record));
          } catch {
            return null;
          }
        })
        .filter((event): event is AuditEvent => event !== null);
    });
  }

  async runRetentionCleanup(days: number): Promise<number> {
    if (days <= 0) return 0;
    await this.ensureSchemaReady();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return await withPostgresClient(this.pool, async (client) => {
      const result = await client.query("DELETE FROM audit_events WHERE timestamp < $1", [cutoff]);
      return result.rowCount ?? 0;
    });
  }

  async importLegacyJsonl(filePath: string): Promise<number> {
    await this.ensureSchemaReady();
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
    await withPostgresClient(this.pool, async (client) => {
      for (const record of records) {
        const result = await client.query(
          "INSERT INTO audit_events (event_id, timestamp, record) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING",
          [record.id, record.timestamp, JSON.stringify(record)]
        );
        imported += result.rowCount ?? 0;
      }
    });
    return imported;
  }

  private async ensureSchemaReady(): Promise<void> {
    this.schemaReady ??= this.ensureSchema();
    await this.schemaReady;
  }

  private async ensureSchema(): Promise<void> {
    await withPostgresClient(this.pool, async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_events (
          event_id text PRIMARY KEY,
          timestamp text NOT NULL,
          record text NOT NULL
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC)");
    });
  }
}

export function resolvePostgresAuditLogPath(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "audit.jsonl");
}
