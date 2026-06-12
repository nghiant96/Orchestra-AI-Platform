import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import type { Worker } from "./worker-types.js";
import type { WorkerRepository } from "../core/repository-contracts.js";
import { withPostgresClient } from "../core/postgres.js";

export class PostgresWorkerStore implements WorkerRepository {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  static generateId(_name: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `worker-${timestamp}-${random}`;
  }

  static generateSessionToken(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 18);
    return `ws_${ts}_${rand}`;
  }

  async create(worker: Partial<Worker> & Pick<Worker, "name">): Promise<Worker> {
    const id = worker.id || PostgresWorkerStore.generateId(worker.name);
    const sessionToken = worker.sessionToken || PostgresWorkerStore.generateSessionToken();
    const now = new Date().toISOString();
    const record: Worker = {
      id,
      name: worker.name,
      version: worker.version || "0.1.0",
      os: worker.os || process.platform,
      arch: worker.arch || process.arch,
      labels: worker.labels || [],
      capabilities: worker.capabilities || {},
      workspaceRoots: worker.workspaceRoots || [],
      status: worker.status || "online",
      lastHeartbeatAt: worker.lastHeartbeatAt || now,
      sessionToken,
      createdAt: worker.createdAt || now,
      currentJobId: worker.currentJobId,
      freeDiskGb: worker.freeDiskGb,
      cpuLoad: worker.cpuLoad
    };
    await this.save(record);
    return record;
  }

  async save(worker: Worker): Promise<void> {
    await this.ensureSchemaReady();
    await withPostgresClient(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO workers (worker_id, last_heartbeat_at, record)
          VALUES ($1, $2, $3)
          ON CONFLICT (worker_id) DO UPDATE SET
            last_heartbeat_at = EXCLUDED.last_heartbeat_at,
            record = EXCLUDED.record
        `,
        [worker.id, worker.lastHeartbeatAt, JSON.stringify(worker)]
      );
    });
  }

  async load(id: string): Promise<Worker | null> {
    await this.ensureSchemaReady();
    return await withPostgresClient(this.pool, async (client) => {
      const result = await client.query<{ record: string }>("SELECT record FROM workers WHERE worker_id = $1", [id]);
      const record = result.rows[0]?.record;
      if (!record) {
        return null;
      }
      try {
        return JSON.parse(record) as Worker;
      } catch {
        return null;
      }
    });
  }

  async list(): Promise<Worker[]> {
    await this.ensureSchemaReady();
    return await withPostgresClient(this.pool, async (client) => {
      const result = await client.query<{ record: string }>("SELECT record FROM workers ORDER BY last_heartbeat_at DESC");
      return result.rows
        .map((row) => {
          try {
            return JSON.parse(row.record) as Worker;
          } catch {
            return null;
          }
        })
        .filter((worker): worker is Worker => worker !== null);
    });
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureSchemaReady();
    return await withPostgresClient(this.pool, async (client) => {
      const result = await client.query("DELETE FROM workers WHERE worker_id = $1", [id]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  async importLegacyWorkersFromDisk(workersDir: string): Promise<number> {
    await this.ensureSchemaReady();
    const workers = await readLegacyWorkersFromDirectory(workersDir);
    let imported = 0;
    for (const worker of workers) {
      await this.save(worker);
      imported += 1;
    }
    return imported;
  }

  private async ensureSchemaReady(): Promise<void> {
    this.schemaReady ??= this.ensureSchema();
    await this.schemaReady;
  }

  private async ensureSchema(): Promise<void> {
    await withPostgresClient(this.pool, async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS workers (
          worker_id text PRIMARY KEY,
          last_heartbeat_at text NOT NULL,
          record text NOT NULL
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_workers_last_heartbeat_at ON workers(last_heartbeat_at DESC)");
    });
  }
}

export async function readLegacyWorkersFromDirectory(workersDir: string): Promise<Worker[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(workersDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const workers: Worker[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    try {
      const raw = await fs.readFile(path.join(workersDir, entry.name), "utf8");
      workers.push(JSON.parse(raw) as Worker);
    } catch {
      continue;
    }
  }

  return workers;
}

export function resolvePostgresWorkerStorePath(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "workers");
}
