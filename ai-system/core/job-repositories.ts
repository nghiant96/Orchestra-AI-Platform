import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
// @ts-expect-error Node 24 exposes node:sqlite at runtime, but the pinned TS libs here do not declare it yet.
import { DatabaseSync } from "node:sqlite";
import { normalizeQueueJob } from "./normalizers.js";
import { createPostgresPool } from "./postgres.js";
import { resolveStoreMode } from "./store-mode.js";
import { PostgresJobRepository } from "./postgres-job-repository.js";
import type { QueueJob } from "./job-queue.js";
import type { JobRecordLockHandle, JobRecordRepository } from "./job-repository.js";

export class FileJobRepository implements JobRecordRepository {
  constructor(private readonly jobsDir: string) {}

  async get(jobId: string): Promise<QueueJob | null> {
    try {
      const raw = await fs.readFile(this.jobPath(jobId), "utf8");
      return normalizeQueueJob(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list(limit = 50): Promise<QueueJob[]> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    let entries: string[];
    try {
      entries = await fs.readdir(this.jobsDir);
    } catch {
      return [];
    }
    const jobs = await Promise.all(
      entries.filter((entry) => entry.endsWith(".json")).map((entry) => this.get(entry.replace(/\.json$/, "")))
    );
    return jobs
      .filter((job): job is QueueJob => job !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async write(job: QueueJob): Promise<void> {
    await fs.mkdir(this.jobsDir, { recursive: true });
    const targetPath = this.jobPath(job.jobId);
    const tempPath = `${targetPath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, targetPath);
  }

  async delete(jobId: string): Promise<boolean> {
    try {
      await fs.unlink(this.jobPath(jobId));
      return true;
    } catch {
      return false;
    }
  }

  async migrateLegacyJobsFromDisk(): Promise<number> {
    return 0;
  }

  async acquireLock(jobId: string): Promise<JobRecordLockHandle | null> {
    return await acquireFileJobLock(this.lockPath(jobId));
  }

  async close(): Promise<void> {}

  private jobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private lockPath(jobId: string): string {
    return `${this.jobPath(jobId)}.lock`;
  }
}

export class SqliteJobRepository implements JobRecordRepository {
  private db: DatabaseSync | null = null;

  constructor(private readonly jobsDir: string) {
    fsSync.mkdirSync(this.jobsDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.jobsDir, "jobs.sqlite"));
    this.ensureSchema();
  }

  async get(jobId: string): Promise<QueueJob | null> {
    const fromDb = this.getSqliteJob(jobId);
    if (fromDb) {
      return fromDb;
    }
    return await this.readSnapshot(jobId);
  }

  async list(limit = 50): Promise<QueueJob[]> {
    const seen = new Map<string, QueueJob>();
    for (const job of this.listSqliteJobs(limit)) {
      seen.set(job.jobId, job);
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
  }

  async write(job: QueueJob): Promise<void> {
    this.upsertSqliteJob(job);
    await this.writeSnapshot(job);
  }

  async delete(jobId: string): Promise<boolean> {
    const removed = this.deleteSqliteJob(jobId);
    await fs.unlink(this.jobPath(jobId)).catch(() => {});
    return removed;
  }

  async migrateLegacyJobsFromDisk(): Promise<number> {
    if (!this.db) {
      return 0;
    }

    let imported = 0;
    let entries: string[];
    try {
      entries = await fs.readdir(this.jobsDir);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const jobId = entry.replace(/\.json$/, "");
      if (!/^[a-z0-9-]+$/i.test(jobId)) continue;
      if (this.getSqliteJob(jobId)) continue;
      try {
        const raw = await fs.readFile(this.jobPath(jobId), "utf8");
        const job = normalizeQueueJob(JSON.parse(raw));
        this.upsertSqliteJob(job);
        imported += 1;
      } catch {
        continue;
      }
    }

    return imported;
  }

  async acquireLock(jobId: string): Promise<JobRecordLockHandle | null> {
    return await acquireFileJobLock(this.lockPath(jobId));
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
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
    const targetPath = this.jobPath(job.jobId);
    const tempPath = `${targetPath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, targetPath);
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

  private lockPath(jobId: string): string {
    return `${this.jobPath(jobId)}.lock`;
  }

  private ensureSchema(): void {
    this.db?.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        cwd TEXT NOT NULL,
        record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs(status, created_at DESC);
    `);
  }

  private getSqliteJob(jobId: string): QueueJob | null {
    if (!this.db) {
      return null;
    }
    const row = this.db
      .prepare("SELECT record FROM jobs WHERE job_id = ?")
      .get(jobId) as { record?: string } | undefined;
    if (!row?.record) {
      return null;
    }
    try {
      return normalizeQueueJob(JSON.parse(row.record));
    } catch {
      return null;
    }
  }

  private listSqliteJobs(limit: number): QueueJob[] {
    if (!this.db) {
      return [];
    }
    const rows = this.db
      .prepare("SELECT record FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{ record?: string }>;
    return rows
      .map((row) => {
        if (!row.record) {
          return null;
        }
        try {
          return normalizeQueueJob(JSON.parse(row.record));
        } catch {
          return null;
        }
      })
      .filter((job): job is QueueJob => job !== null);
  }

  private upsertSqliteJob(job: QueueJob): void {
    if (!this.db) {
      return;
    }
    const record = JSON.stringify(job, null, 2);
    this.db
      .prepare(
        `
          INSERT INTO jobs (job_id, created_at, updated_at, status, cwd, record)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(job_id) DO UPDATE SET
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            status = excluded.status,
            cwd = excluded.cwd,
            record = excluded.record
        `
      )
      .run(job.jobId, job.createdAt, job.updatedAt, job.status, job.cwd, record);
  }

  private deleteSqliteJob(jobId: string): boolean {
    if (!this.db) {
      return false;
    }
    const result = this.db.prepare("DELETE FROM jobs WHERE job_id = ?").run(jobId);
    return result.changes > 0;
  }
}

export function createJobRecordRepository(jobsDir: string): JobRecordRepository {
  const mode = resolveStoreMode();
  if (mode === "postgres") {
    return new PostgresJobRepository(createPostgresPool(), jobsDir);
  }
  if (mode === "sqlite") {
    return new SqliteJobRepository(jobsDir);
  }
  return new FileJobRepository(jobsDir);
}

async function acquireFileJobLock(lockPath: string): Promise<JobRecordLockHandle | null> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${process.pid}:${Date.now()}\n`, "utf8");
      let released = false;
      return {
        async release(): Promise<void> {
          if (released) {
            return;
          }
          released = true;
          await handle.close().catch(() => {});
          await fs.unlink(lockPath).catch(() => {});
        }
      };
    } catch (err: any) {
      if (err.code !== "EEXIST") {
        throw err;
      }
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        await fs.unlink(lockPath).catch(() => {});
        continue;
      }
      return null;
    }
  }
  return null;
}
