import path from "node:path";
import process from "node:process";
import { createPostgresPool } from "../ai-system/core/postgres.js";
import { PostgresJobRepository, resolvePostgresJobRepositoryDirectory } from "../ai-system/core/postgres-job-repository.js";
import { PostgresAuditLog, resolvePostgresAuditLogPath } from "../ai-system/core/postgres-audit-log.js";
import { PostgresWorkerStore, resolvePostgresWorkerStorePath } from "../ai-system/workers/postgres-worker-store.js";

interface MigrationFlags {
  jobs: boolean;
  audit: boolean;
  workers: boolean;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const defaultCwd = path.resolve(process.env.AI_SYSTEM_WORKDIR || process.cwd());
  const pool = createPostgresPool();

  const jobsDir = resolvePostgresJobRepositoryDirectory(defaultCwd);
  const auditPath = resolvePostgresAuditLogPath(defaultCwd);
  const workersDir = resolvePostgresWorkerStorePath(defaultCwd);

  const jobRepository = new PostgresJobRepository(pool, jobsDir);
  const auditLog = new PostgresAuditLog(pool);
  const workerStore = new PostgresWorkerStore(pool);

  try {
    let total = 0;

    if (flags.jobs) {
      const importedJobs = await jobRepository.migrateLegacyJobsFromDisk();
      total += importedJobs;
      console.log(`jobs: imported ${importedJobs}`);
    }

    if (flags.audit) {
      const importedEvents = await auditLog.importLegacyJsonl(auditPath);
      total += importedEvents;
      console.log(`audit: imported ${importedEvents}`);
    }

    if (flags.workers) {
      const importedWorkers = await workerStore.importLegacyWorkersFromDisk(workersDir);
      total += importedWorkers;
      console.log(`workers: imported ${importedWorkers}`);
    }

    console.log(`postgres migration complete: ${total} record(s) imported`);
  } finally {
    await pool.end();
  }
}

function parseFlags(argv: string[]): MigrationFlags {
  const wantJobs = argv.includes("--jobs");
  const wantAudit = argv.includes("--audit");
  const wantWorkers = argv.includes("--workers");
  if (!wantJobs && !wantAudit && !wantWorkers) {
    return { jobs: true, audit: true, workers: true };
  }
  return {
    jobs: wantJobs,
    audit: wantAudit,
    workers: wantWorkers
  };
}

main().catch((error) => {
  console.error(`[error] ${(error as Error).message}`);
  process.exit(1);
});
