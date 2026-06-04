import test from "node:test";
import assert from "node:assert/strict";
import { resolveServerAuthToken } from "../ai-system/server-startup.js";

test("resolveServerAuthToken rejects missing and placeholder tokens", async () => {
  assert.throws(() => resolveServerAuthToken(undefined), /required in server mode/);
  assert.throws(() => resolveServerAuthToken("change-me"), /real secret/);
  assert.throws(() => resolveServerAuthToken("smoke-server-token"), /real secret/);
});

test("resolveServerAuthToken accepts real secrets", async () => {
  assert.equal(resolveServerAuthToken("dev-token"), "dev-token");
  assert.equal(resolveServerAuthToken(" production-secret "), "production-secret");
});
