import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { createAiSystemServer, type ServerRateLimitOptions } from "../ai-system/server-app.js";
import { FixedWindowRateLimiter, isLoopbackAddress, resolveClientAddress } from "../ai-system/security/rate-limit.js";
import { listen, closeServer, silentLogger, removeTempDir } from "./test-utils.js";

const SERVER_TOKEN = "rate-limit-server-token";

test("FixedWindowRateLimiter allows the limit per window, then resets", () => {
  let now = 1_000_000;
  const limiter = new FixedWindowRateLimiter(2, 60_000, () => now);

  assert.equal(limiter.hit("a").allowed, true);
  assert.equal(limiter.hit("a").allowed, true);
  const denied = limiter.hit("a");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 60);
  assert.equal(limiter.hit("b").allowed, true, "keys are counted separately");

  now += 60_000;
  assert.equal(limiter.hit("a").allowed, true, "a new window starts fresh");
});

test("FixedWindowRateLimiter.check reports exhaustion without counting", () => {
  const limiter = new FixedWindowRateLimiter(2, 60_000, () => 0);
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, true);
  limiter.hit("a");
  assert.equal(limiter.check("a").allowed, true);
  limiter.hit("a");
  assert.equal(limiter.check("a").allowed, false);
});

test("resolveClientAddress only honours X-Forwarded-For behind a trusted proxy", () => {
  const req = {
    headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.7" },
    socket: { remoteAddress: "10.0.0.2" }
  } as unknown as http.IncomingMessage;

  assert.equal(resolveClientAddress(req, false), "10.0.0.2");
  // The last entry is the one the proxy appended; earlier ones are client-supplied.
  assert.equal(resolveClientAddress(req, true), "203.0.113.7");
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("203.0.113.7"), false);
});

async function withServer(rateLimit: ServerRateLimitOptions, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rate-limit-test-"));
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot],
    authToken: SERVER_TOKEN,
    logger: silentLogger(),
    runner: async () => ({ ok: true } as any),
    rateLimit
  });
  try {
    await fn(await listen(server));
  } finally {
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
}

function get(baseUrl: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/health`, { headers: { Authorization: `Bearer ${SERVER_TOKEN}`, ...headers } });
}

test("server answers 429 with Retry-After once a client exceeds its request budget", async () => {
  await withServer({ requestsPerMinute: 3 }, async (baseUrl) => {
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await get(baseUrl)).status, 200);
    }
    const limited = await get(baseUrl);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.deepEqual(await limited.json(), { ok: false, error: "Too many requests" });
  });
});

test("repeated bad tokens lock out that address, even for a valid token", async () => {
  await withServer({ authFailuresPerWindow: 2, trustProxy: true }, async (baseUrl) => {
    const attacker = { "X-Forwarded-For": "203.0.113.7" };
    const wrong = { ...attacker, Authorization: "Bearer guess" };

    assert.equal((await get(baseUrl, wrong)).status, 401);
    assert.equal((await get(baseUrl, wrong)).status, 401);
    // Locked out: a correct guess must look no different from a wrong one.
    assert.equal((await get(baseUrl, attacker)).status, 429);
    assert.equal((await get(baseUrl, wrong)).status, 429);

    // Other addresses are unaffected.
    assert.equal((await get(baseUrl, { "X-Forwarded-For": "203.0.113.8" })).status, 200);
  });
});

test("loopback clients are never locked out by failed authentication", async () => {
  await withServer({ authFailuresPerWindow: 2 }, async (baseUrl) => {
    for (let index = 0; index < 5; index += 1) {
      assert.equal((await get(baseUrl, { Authorization: "Bearer stale-worker-token" })).status, 401);
    }
    assert.equal((await get(baseUrl)).status, 200);
  });
});
