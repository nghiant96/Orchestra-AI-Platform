import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir } from "./test-utils.js";

const OPERATOR = {
  Authorization: "Bearer dispatch-route-token",
  "x-ai-system-role": "operator",
  "x-ai-system-actor": "dispatch-route-test"
};

test("POST /work-items/dispatch queues the whole ready backlog in one call", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dispatch-route-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    authToken: "dispatch-route-token",
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async () => ({ ok: true }) as any
  });

  try {
    const baseUrl = await listen(server);

    const titles = ["Route alpha", "Route beta"];
    for (const title of titles) {
      await requestJson(baseUrl, "POST", "/work-items", { cwd: repoRoot, title, description: title }, 201, OPERATOR);
    }

    const dispatch = await requestJson(
      baseUrl,
      "POST",
      "/work-items/dispatch",
      { cwd: repoRoot, dryRun: true },
      202,
      OPERATOR
    );

    assert.equal(dispatch.ok, true, `dispatch failures: ${JSON.stringify(dispatch.failed)}`);
    assert.equal(dispatch.dispatched.length, titles.length);

    // The jobs must be visible through the public jobs API, not just in the
    // dispatch response — that is what a worker fleet claims from.
    const jobIds: string[] = dispatch.dispatched.flatMap((entry: { jobIds: string[] }) => entry.jobIds);
    assert.ok(jobIds.length >= titles.length);

    const listed = await requestJson(baseUrl, "GET", `/jobs?cwd=${encodeURIComponent(repoRoot)}`, undefined, 200, OPERATOR);
    const listedIds = new Set(listed.jobs.map((job: { jobId: string }) => job.jobId));
    for (const jobId of jobIds) {
      assert.ok(listedIds.has(jobId), `job ${jobId} should be listed by the jobs API`);
    }
  } finally {
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
});

test("dispatch rejects a bad maxParallel and a cwd outside the allowlist", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dispatch-route-guard-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dispatch-route-outside-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    authToken: "dispatch-route-token",
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async () => ({ ok: true }) as any
  });

  try {
    const baseUrl = await listen(server);

    const badCap = await requestJson(
      baseUrl,
      "POST",
      "/work-items/dispatch",
      { cwd: repoRoot, maxParallel: 0 },
      400,
      OPERATOR
    );
    assert.match(badCap.error, /maxParallel/);

    const outside = await requestJson(
      baseUrl,
      "POST",
      "/work-items/dispatch",
      { cwd: outsideRoot },
      403,
      OPERATOR
    );
    assert.match(outside.error, /outside AI_SYSTEM_ALLOWED_WORKDIRS/);

    // "dispatch" is not a work item id, and a malformed id is a client error —
    // it must not surface as a 500 from the path-traversal guard in the store.
    const malformed = await requestJson(
      baseUrl,
      "GET",
      `/work-items/dispatch?cwd=${encodeURIComponent(repoRoot)}`,
      undefined,
      400,
      OPERATOR
    );
    assert.match(malformed.error, /Invalid work item id/);

    const missing = await requestJson(
      baseUrl,
      "GET",
      `/work-items/work-does-not-exist?cwd=${encodeURIComponent(repoRoot)}`,
      undefined,
      404,
      OPERATOR
    );
    assert.equal(missing.ok, false);
  } finally {
    await closeServer(server);
    await removeTempDir(repoRoot);
    await removeTempDir(outsideRoot);
  }
});
