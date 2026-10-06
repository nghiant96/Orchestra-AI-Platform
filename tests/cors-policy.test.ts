import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { parseCorsOrigins } from "../ai-system/security/cors-policy.js";
import { listen, closeServer, silentLogger, removeTempDir } from "./test-utils.js";

const DASHBOARD_ORIGIN = "http://localhost:5253";

test("parseCorsOrigins normalizes exact origins and skips blanks", () => {
  assert.deepEqual([...parseCorsOrigins([" http://localhost:5253/ ", "", "https://ops.example.com"])], [
    "http://localhost:5253",
    "https://ops.example.com"
  ]);
  assert.equal(parseCorsOrigins([]).size, 0);
});

test("parseCorsOrigins refuses wildcards and anything that is not a bare origin", () => {
  assert.throws(() => parseCorsOrigins(["*"]), /does not accept '\*'/);
  assert.throws(() => parseCorsOrigins(["localhost:5253"]), /scheme:\/\/host/);
  assert.throws(() => parseCorsOrigins(["http://localhost:5253/dashboard"]), /scheme:\/\/host/);
  assert.throws(() => parseCorsOrigins(["not a url"]), /not a valid origin/);
});

test("server grants CORS only to allowlisted origins", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cors-policy-test-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async () => ({ ok: true } as any),
    corsOrigins: [DASHBOARD_ORIGIN]
  });

  try {
    const baseUrl = await listen(server);

    const allowed = await fetch(`${baseUrl}/health`, { method: "OPTIONS", headers: { Origin: DASHBOARD_ORIGIN } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), DASHBOARD_ORIGIN);
    assert.match(allowed.headers.get("access-control-allow-headers") ?? "", /Authorization/);
    assert.match(allowed.headers.get("vary") ?? "", /Origin/);

    const allowedGet = await fetch(`${baseUrl}/health`, { headers: { Origin: DASHBOARD_ORIGIN } });
    assert.equal(allowedGet.headers.get("access-control-allow-origin"), DASHBOARD_ORIGIN);

    const foreign = await fetch(`${baseUrl}/health`, { method: "OPTIONS", headers: { Origin: "https://attacker.example" } });
    assert.equal(foreign.status, 204);
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);
    assert.equal(foreign.headers.get("access-control-allow-headers"), null);
  } finally {
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
});

test("server refuses to start with a wildcard CORS origin", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cors-policy-wildcard-"));
  try {
    assert.throws(
      () =>
        createAiSystemServer({
          defaultCwd: repoRoot,
          allowedWorkdirs: [repoRoot],
          logger: silentLogger(),
          runner: async () => ({ ok: true } as any),
          corsOrigins: ["*"]
        }),
      /does not accept '\*'/
    );
  } finally {
    await removeTempDir(repoRoot);
  }
});
