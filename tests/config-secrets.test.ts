import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { MASKED_SECRET, maskSecretFields, restoreMaskedSecrets } from "../ai-system/security/secret-redaction.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir } from "./test-utils.js";

test("maskSecretFields masks secret-named strings and leaves look-alikes alone", () => {
  const masked = maskSecretFields({
    providers: { generator: { api_key: "real-key", api_key_env: "OPENAI_API_KEY", model: "m" } },
    webhooks: [{ url: "https://hooks.example", secret: "whsec-1" }],
    auth: { auth_token: "t-1" },
    max_tokens: 4096,
    empty: { secret: "" }
  });
  assert.equal(masked.providers.generator.api_key, MASKED_SECRET);
  assert.equal(masked.providers.generator.api_key_env, "OPENAI_API_KEY");
  assert.equal(masked.webhooks[0].secret, MASKED_SECRET);
  assert.equal(masked.webhooks[0].url, "https://hooks.example");
  assert.equal(masked.auth.auth_token, MASKED_SECRET);
  assert.equal(masked.max_tokens, 4096);
  assert.equal(masked.empty.secret, "");
});

test("restoreMaskedSecrets puts back real values, inside arrays too", () => {
  const existing = { webhooks: [{ url: "a", secret: "whsec-1" }], memory: { api_key: "k" } };
  const restored = restoreMaskedSecrets(
    { webhooks: [{ url: "a", secret: MASKED_SECRET }], memory: { api_key: MASKED_SECRET }, extra: { token: MASKED_SECRET } },
    existing
  );
  assert.deepEqual(restored, { webhooks: [{ url: "a", secret: "whsec-1" }], memory: { api_key: "k" }, extra: {} });
});

test("GET /config never returns webhook secrets, and saving the masked copy keeps them", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "config-secrets-"));
  const configPath = path.join(repoRoot, ".ai-system.json");
  const webhook = { url: "http://127.0.0.1:9/hook", secret: "whsec-real-signing-secret", events: ["never.fires"], enabled: true };
  await fs.writeFile(configPath, JSON.stringify({ webhooks: [webhook], max_iterations: 3 }), "utf8");
  const server = createAiSystemServer({ defaultCwd: repoRoot, allowedWorkdirs: [repoRoot], logger: silentLogger(), runner: async () => ({ ok: true } as any) });

  try {
    const baseUrl = await listen(server);
    const config = await requestJson(baseUrl, "GET", "/config", undefined, 200);
    assert.equal(config.rules.webhooks[0].secret, MASKED_SECRET);
    assert.doesNotMatch(JSON.stringify(config), /whsec-real-signing-secret/);

    // Save back exactly what was read, with one real change.
    const saved = await requestJson(baseUrl, "POST", "/config", { webhooks: config.rules.webhooks, max_iterations: 4 }, 200);
    assert.doesNotMatch(JSON.stringify(saved), /whsec-real-signing-secret/);

    const onDisk = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(onDisk.webhooks[0].secret, "whsec-real-signing-secret");
    assert.equal(onDisk.max_iterations, 4);
  } finally {
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
});
