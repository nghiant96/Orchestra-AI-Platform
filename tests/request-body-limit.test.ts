import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir } from "./test-utils.js";

const AUTH = {
  Authorization: "Bearer body-limit-token",
  "x-ai-system-role": "operator",
  "x-ai-system-actor": "body-limit-test"
};

test("oversized request bodies are refused with 413 instead of being buffered", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "body-limit-"));
  const previousLimit = process.env.AI_SYSTEM_MAX_BODY_BYTES;
  process.env.AI_SYSTEM_MAX_BODY_BYTES = "2048";

  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    authToken: "body-limit-token",
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async () => ({ ok: true }) as any
  });

  try {
    const baseUrl = await listen(server);

    // A body under the ceiling still works.
    const accepted = await requestJson(
      baseUrl,
      "POST",
      "/jobs",
      { task: "small enough", cwd: repoRoot, dryRun: true },
      202,
      AUTH
    );
    assert.equal(accepted.status, "queued");

    // Declared oversize is rejected up front, before any of it is read.
    const declared = await rawPost(baseUrl, "/jobs", JSON.stringify({ task: "x".repeat(8192), cwd: repoRoot }), true);
    assert.equal(declared.statusCode, 413);
    assert.match(String(declared.body), /exceeds the 2048 byte limit/);

    // Chunked upload hides the size from Content-Length; the byte counter still
    // has to stop it.
    const streamed = await rawPost(baseUrl, "/jobs", JSON.stringify({ task: "y".repeat(8192), cwd: repoRoot }), false);
    assert.equal(streamed.statusCode, 413);

    // Malformed JSON is a client error too, not a 500.
    const malformed = await rawPost(baseUrl, "/jobs", "{ not json", true);
    assert.equal(malformed.statusCode, 400);
    assert.match(String(malformed.body), /not valid JSON/);

    // The server is still healthy after all of that.
    const health = await requestJson(baseUrl, "GET", "/health", undefined, 200, AUTH);
    assert.equal(health.ok, true);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.AI_SYSTEM_MAX_BODY_BYTES;
    } else {
      process.env.AI_SYSTEM_MAX_BODY_BYTES = previousLimit;
    }
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
});

function rawPost(
  baseUrl: string,
  pathname: string,
  payload: string,
  declareLength: boolean
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...AUTH, "Content-Type": "application/json" };
    if (declareLength) {
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    } else {
      headers["Transfer-Encoding"] = "chunked";
    }

    const req = http.request(new URL(pathname, baseUrl), { method: "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    // The server may close the socket once it stops reading an oversized body;
    // that is the intended outcome, not a test failure.
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNRESET" || error.code === "EPIPE") return;
      reject(error);
    });
    req.end(payload);
  });
}
