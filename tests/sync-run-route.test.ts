import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import type { JobRunner } from "../ai-system/core/job-queue.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir, waitForJobStatus } from "./test-utils.js";

const okResult = (cwd: string) => ({ version: 1, ok: true, status: "completed", repoRoot: cwd } as any);

async function withServer(runner: JobRunner, fn: (baseUrl: string, repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sync-run-route-")));
  const server = createAiSystemServer({ defaultCwd: repoRoot, allowedWorkdirs: [repoRoot], logger: silentLogger(), runner });
  try {
    await fn(await listen(server), repoRoot);
  } finally {
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
}

test("POST /run requires the operator role, like POST /jobs", async () => {
  await withServer(async ({ cwd }) => okResult(cwd), async (baseUrl) => {
    const denied = await requestJson(baseUrl, "POST", "/run", { task: "sync run" }, 403, { "x-ai-system-role": "viewer" });
    assert.equal(denied.ok, false);
  });
});

test("POST /run refuses a task that would wait for an approval nobody can give", async () => {
  let runs = 0;
  await withServer(async ({ cwd }) => {
    runs += 1;
    return okResult(cwd);
  }, async (baseUrl) => {
    const refused = await requestJson(baseUrl, "POST", "/run", { task: "rewrite the payments authentication flow", dryRun: false }, 409);
    assert.match(refused.error, /needs approval/);
    assert.equal(runs, 0);
  });
});

test("POST /run is refused while the queue is paused", async () => {
  await withServer(async ({ cwd }) => okResult(cwd), async (baseUrl) => {
    await requestJson(baseUrl, "POST", "/queue/pause", undefined, 200);
    const refused = await requestJson(baseUrl, "POST", "/run", { task: "sync run" }, 409);
    assert.match(refused.error, /paused/);
  });
});

test("POST /run will not run on top of a queued job in the same workspace", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await withServer(async ({ cwd, task }) => {
    if (task === "queued job") await gate;
    return okResult(cwd);
  }, async (baseUrl, repoRoot) => {
    const queued = await requestJson(baseUrl, "POST", "/jobs", { task: "queued job", cwd: repoRoot, dryRun: true }, 202);
    await waitForJobStatus(baseUrl, String(queued.jobId), "running");

    const refused = await requestJson(baseUrl, "POST", "/run", { task: "sync run", cwd: repoRoot }, 409);
    assert.match(refused.error, /Another job is running/);

    release();
    await waitForJobStatus(baseUrl, String(queued.jobId), "completed");
    const allowed = await requestJson(baseUrl, "POST", "/run", { task: "sync run", cwd: repoRoot }, 200);
    assert.equal(allowed.ok, true);
  });
});
