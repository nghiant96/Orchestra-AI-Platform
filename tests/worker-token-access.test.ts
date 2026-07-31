import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir } from "./test-utils.js";

test("worker token can register but cannot list workers", async () => {
  const previousWorkerToken = process.env.ORCHESTRA_WORKER_TOKEN;
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worker-token-access-test-"));
  process.env.ORCHESTRA_WORKER_TOKEN = "worker-test-token";

  const server: http.Server = createAiSystemServer({
    defaultCwd: repoRoot,
    logger: silentLogger(),
    runner: async () => ({ ok: true } as any),
    allowedWorkdirs: [repoRoot]
  });

  try {
    const baseUrl = await listen(server);

    const denied = await requestJson(baseUrl, "GET", "/workers", undefined, 403, {
      Authorization: "Bearer worker-test-token"
    });
    assert.equal(denied.ok, false);

    const created = await requestJson(baseUrl, "POST", "/workers", {
      name: "worker-auth-test",
      os: "linux",
      workspaceRoots: [repoRoot]
    }, 201, {
      Authorization: "Bearer worker-test-token"
    });

    assert.equal(created.ok, true);
    assert.ok(created.worker.id.startsWith("worker-"));
  } finally {
    if (previousWorkerToken === undefined) {
      delete process.env.ORCHESTRA_WORKER_TOKEN;
    } else {
      process.env.ORCHESTRA_WORKER_TOKEN = previousWorkerToken;
    }
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
});
