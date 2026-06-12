import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLegacyWorkersFromDirectory, resolvePostgresWorkerStorePath } from "../ai-system/workers/postgres-worker-store.js";

test("reads legacy worker records from disk", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "postgres-worker-migration-"));
  const workersDir = path.join(tmpDir, ".ai-system-server", "workers");
  await fs.mkdir(workersDir, { recursive: true });

  const record = {
    id: "worker-legacy-1",
    name: "legacy worker",
    version: "1.0.0",
    os: process.platform,
    arch: process.arch,
    labels: ["codex"],
    capabilities: {},
    workspaceRoots: [tmpDir],
    status: "idle",
    lastHeartbeatAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(workersDir, "worker-legacy-1.json"), JSON.stringify(record, null, 2), "utf8");

  const workers = await readLegacyWorkersFromDirectory(workersDir);
  assert.equal(workers.length, 1);
  assert.equal(workers[0]?.id, "worker-legacy-1");
  assert.equal(resolvePostgresWorkerStorePath(tmpDir), workersDir);
});
