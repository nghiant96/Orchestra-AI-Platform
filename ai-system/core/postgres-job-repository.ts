import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import type { QueueJob } from "./job-queue.js";
import { normalizeQueueJob } from "./normalizers.js";
import { writeFileAtomic } from "../utils/atomic-file.js";
import type { JobRecordLockHandle, JobRecordRepository } from "./job-repository.js";
import { withPostgresClient } from "./postgres.js";

export class PostgresJobRepository implements JobRecordRepository {
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly jobsDir: string
  ) {}

  async get(jobId: string): Promise<QueueJob | null> {
    await this.ensureSchemaReady();
    return await withPostgresClient(this.pool, async (client) => {
      const result = await client.query<{ record: string }>("SELECT record FROM jobs WHERE job_id = $1", [jobId]);
      const record = result.rows[0]?.record;
      if (!record) {
        return await this.readSnapshot(jobId);
      }
      try {
        return normalizeQueueJob(JSON.parse(record));
      } catch {
        return null;
      }
    });
  }

  async list(limit = 50): Promise<QueueJob[]> {
    await this.ensureSchemaReady();
    return await withPostgresClient(this.pool, async (client) => {
      const seen = new Map<string, QueueJob>();
      const result = await client.query<{ record: string }>(
        "SELECT record FROM jobs ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
      for (const row of result.rows) {
        try {
          const job = normalizeQueueJob(JSON.parse(row.record));
          seen.set(job.jobId, job);
        } catch {
          continue;
        }
      }

      const snapshots = await this.listSnapshotJobs(limit);
      for (const job of snapshots) {
        if (!seen.has(job.jobId)) {
          seen.set(job.jobId, job);
        }
      }

      return [...seen.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    });
  }

  async write(job: QueueJob): Promise<void> {
    await this.ensureSchemaReady();
    await withPostgresClient(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO jobs (job_id, created_at, updated_at, status, cwd, record)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (job_id) DO UPDATE SET
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            status = EXCLUDED.status,
            cwd = EXCLUDED.cwd,
            record = EXCLUDED.record
        `,
        [job.jobId, job.createdAt, job.updatedAt, job.status, job.cwd, JSON.stringify(job, null, 2)]
      );
      await this.writeSnapshot(job);
    });
  }

  async delete(jobId: string): Promise<boolean> {
    await this.ensureSchemaReady();
    return await withPostgresClient(this.pool, async (client) => {
      const result = await client.query("DELETE FROM jobs WHERE job_id = $1", [jobId]);
      await client.query("DELETE FROM job_locks WHERE lock_key = $1", [this.lockKey(jobId)]);
      await fs.unlink(this.jobPath(jobId)).catch(() => {});
      return (result.rowCount ?? 0) > 0;
    });
  }

  async migrateLegacyJobsFromDisk(): Promise<number> {
    await this.ensureSchemaReady();
    let entries: string[];
    try {
      entries = await fs.readdir(this.jobsDir);
    } catch {
      return 0;
    }

    let imported = 0;
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const jobId = entry.replace(/\.json$/, "");
      if (!/^[a-z0-9-]+$/i.test(jobId)) continue;
      try {
        const raw = await fs.readFile(this.jobPath(jobId), "utf8");
        const job = normalizeQueueJob(JSON.parse(raw));
        await this.write(job);
        imported += 1;
      } catch {
        continue;
      }
    }
    return imported;
  }

  async acquireLock(jobId: string): Promise<JobRecordLockHandle | null> {
    await this.ensureSchemaReady();
    const client = await this.pool.connect();
    const lockKey = this.lockKey(jobId);
    const ownerId = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date(Date.now() + 30_000).toISOString();

    try {
      await client.query("DELETE FROM job_locks WHERE lock_key = $1 AND expires_at < $2", [
        lockKey,
        new Date().toISOString()
      ]);
      const result = await client.query(
        `
          INSERT INTO job_locks (lock_key, owner_id, expires_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (lock_key) DO NOTHING
          RETURNING lock_key
        `,
        [lockKey, ownerId, expiresAt]
      );

      if ((result.rowCount ?? 0) === 0) {
        client.release();
        return null;
      }

      let released = false;
      return {
        async release(): Promise<void> {
          if (released) {
            return;
          }
          released = true;
          try {
            await client.query("DELETE FROM job_locks WHERE lock_key = $1 AND owner_id = $2", [lockKey, ownerId]);
          } finally {
            client.release();
          }
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureSchemaReady(): Promise<void> {
    this.schemaReady ??= this.ensureSchema();
    await this.schemaReady;
  }

  private async ensureSchema(): Promise<void> {
    await withPostgresClient(this.pool, async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          job_id text PRIMARY KEY,
          created_at text NOT NULL,
          updated_at text NOT NULL,
          status text NOT NULL,
          cwd text NOT NULL,
          record text NOT NULL
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)");
      await client.query("CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs(status, created_at DESC)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS job_locks (
          lock_key text PRIMARY KEY,
          owner_id text NOT NULL,
          expires_at text NOT NULL
        )
      `);
      await client.query("CREATE INDEX IF NOT EXISTS idx_job_locks_expires_at ON job_locks(expires_at)");
    });
  }

  private async readSnapshot(jobId: string): Promise<QueueJob | null> {
    try {
      const raw = await fs.readFile(this.jobPath(jobId), "utf8");
      return normalizeQueueJob(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async writeSnapshot(job: QueueJob): Promise<void> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    await writeFileAtomic(this.jobPath(job.jobId), `${JSON.stringify(job, null, 2)}\n`);
  }

  private async listSnapshotJobs(limit: number): Promise<QueueJob[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.jobsDir);
    } catch {
      return [];
    }
    const jobs = await Promise.all(
      entries.filter((entry) => entry.endsWith(".json")).map((entry) => this.readSnapshot(entry.replace(/\.json$/, "")))
    );
    return jobs.filter((job): job is QueueJob => job !== null).slice(0, limit);
  }

  private jobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private lockKey(jobId: string): string {
    return `job:${jobId}`;
  }
}

export function resolvePostgresJobRepositoryDirectory(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "jobs");
}
