import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, redactObject, redactJsonString } from "../ai-system/security/secret-redaction.js";

test("redactSecrets redacts OpenAI API keys", () => {
  const result = redactSecrets("My key is sk-proj-abcdef1234567890123456789 in the config");
  assert.ok(result.includes("sk-REDACTED"));
  assert.ok(!result.includes("sk-proj-abcdef"));
});

test("redactSecrets redacts GitHub tokens", () => {
  const result = redactSecrets("Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890123456");
  assert.ok(result.includes("ghp_REDACTED"));
  assert.ok(!result.includes("ghp_abcdefghijklmnopqrstuvwxyz"));
});

test("redactSecrets redacts GitLab tokens", () => {
  const result = redactSecrets("Token: glpat-abcdefghijklmnopqrstuvwxyz12");
  assert.ok(result.includes("glpat-REDACTED"));
});

test("redactSecrets redacts AWS access keys", () => {
  const result = redactSecrets("Key: AKIAIOSFODNN7EXAMPLE");
  assert.ok(result.includes("AKIAREDACTED"));
  assert.ok(!result.includes("AKIAIOSFODNN7EXAMPLE"));
});

test("redactSecrets redacts private key headers", () => {
  const result = redactSecrets("Contains -----BEGIN RSA PRIVATE KEY----- in the file");
  assert.ok(result.includes("-----BEGIN REDACTED PRIVATE KEY-----"));
  assert.ok(!result.includes("-----BEGIN RSA PRIVATE KEY-----"));
});

test("redactSecrets redacts JWT tokens", () => {
  const result = redactSecrets("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
  assert.ok(result.includes("REDACTED"));
  assert.ok(!result.includes("eyJhbGci"));
});

test("redactSecrets redacts Bearer tokens", () => {
  const result = redactSecrets("Authorization: Bearer abcdefghijklmnop123456");
  assert.ok(result.includes("Bearer REDACTED"));
});

test("redactSecrets redacts URLs with passwords", () => {
  const result = redactSecrets("https://user:password123@example.com/repo.git");
  assert.ok(result.includes("REDACTED@"));
  assert.ok(!result.includes("password123"));
});

test("redactSecrets redacts npm tokens", () => {
  const result = redactSecrets("//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz123456789");
  assert.ok(result.includes("npm_REDACTED"));
});

test("redactSecrets passes through normal text", () => {
  const input = "Hello world, this is a normal message about deploying to production.";
  const result = redactSecrets(input);
  assert.equal(result, input);
});

test("redactObject redacts nested objects", () => {
  const input = {
    api_key: "sk-test123456789012345678901234",
    nested: { token: "ghp_testabcdefghijklmnopqrstuvwxyz123" },
    items: ["normal", "sk-another1234567890123456789012"]
  };
  const result = redactObject(input);
  assert.ok((result.api_key as string).includes("sk-REDACTED"));
  assert.ok((result.nested as any).token.includes("ghp_REDACTED"));
  assert.ok((result.items as string[])[1]!.includes("sk-REDACTED"));
});

test("redactJsonString redacts JSON strings", () => {
  const input = JSON.stringify({ secret: "ghp_test123456789012345678901234567890", name: "test" });
  const result = redactJsonString(input);
  assert.ok(result.includes("ghp_REDACTED"));
  assert.ok(result.includes('"name":"test"'));
});
