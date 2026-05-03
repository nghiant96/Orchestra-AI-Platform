import test from "node:test";
import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { requestJson } from "./test-utils.js";
import type http from "node:http";

async function cleanupDir(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("Dashboard smoke tests: verify core API endpoints and CORS", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-dashboard-smoke-"));
  const silentLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    step: () => {},
    log: () => {},
    debug: () => {},
  } as any;

  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger,
  });

  const baseUrl = await new Promise<string>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });

  try {
    // Test 1: Health endpoint
    const health = await requestJson(baseUrl, "GET", "/health", undefined, 200);
    assert.equal(health.ok, true);
    assert.equal(health.status, "online");

    // Test 2: CORS headers on OPTIONS
    const optionsReq = await fetch(`${baseUrl}/health`, { method: "OPTIONS" });
    assert.equal(optionsReq.status, 204);
    assert.equal(optionsReq.headers.get("access-control-allow-origin"), "*");
    assert.ok(optionsReq.headers.get("access-control-allow-methods")?.includes("GET"));

    // Test 3: List Jobs (Dashboard View)
    const jobsList = await requestJson(baseUrl, "GET", `/jobs?cwd=${encodeURIComponent(repoRoot)}`, undefined, 200);
    assert.ok(Array.isArray(jobsList.jobs));

    // Test 4: List Work Items (Dashboard View)
    const workItemsList = await requestJson(baseUrl, "GET", `/work-items?cwd=${encodeURIComponent(repoRoot)}`, undefined, 200);
    assert.equal(workItemsList.ok, true);
    assert.ok(Array.isArray(workItemsList.workItems));

    // Test 5: Graceful 404 for missing jobs
    try {
      await requestJson(baseUrl, "GET", "/jobs/invalid-job-id");
      assert.fail("Should throw 404");
    } catch (err: any) {
      assert.match(err.message, /HTTP 404/);
      assert.match(err.message, /Job not found/);
    }

  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
  }
});
