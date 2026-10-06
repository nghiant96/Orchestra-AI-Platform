import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { capActorRole } from "../ai-system/core/audit-log.js";
import { canPerformAction } from "../ai-system/core/permissions.js";
import { canAccessRoute, maxActorRoleForToken } from "../ai-system/security/token-policy.js";
import type { RulesConfig } from "../ai-system/types.js";
import { listen, closeServer, silentLogger, requestJson, removeTempDir } from "./test-utils.js";

const SERVER_TOKEN = "ceiling-server-token";
const HERMES_TOKEN = "ceiling-hermes-token";

test("only the server token may act above operator", () => {
  assert.equal(maxActorRoleForToken("server"), undefined);
  assert.equal(maxActorRoleForToken("dashboard"), undefined);
  assert.equal(maxActorRoleForToken("hermes"), "operator");
  assert.equal(maxActorRoleForToken("worker"), "viewer");
});

test("capActorRole lowers an over-claimed role and leaves a lower one alone", () => {
  assert.deepEqual(capActorRole({ id: "a", role: "admin" }, "operator"), { id: "a", role: "operator", maxRole: "operator" });
  assert.deepEqual(capActorRole({ id: "a", role: "viewer" }, "operator"), { id: "a", role: "viewer", maxRole: "operator" });
  assert.deepEqual(capActorRole({ id: "a", role: "admin" }, undefined), { id: "a", role: "admin" });
});

test("project role mapping cannot lift an actor above its token ceiling", () => {
  // The mapping is keyed on X-AI-System-Actor, which any client can set.
  const rules = {
    auth: {
      project_role_mapping: { demo: { "root@example.com": "admin" } },
      action_permissions: { "config.update": "admin" }
    }
  } as unknown as RulesConfig;

  const viaHermes = capActorRole({ id: "root@example.com", role: "viewer" }, "operator");
  assert.equal(canPerformAction(viaHermes, rules, "config.update", "demo"), false);

  const viaServer = { id: "root@example.com", role: "viewer" as const };
  assert.equal(canPerformAction(viaServer, rules, "config.update", "demo"), true);
});

test("hermes may read config but not write it", () => {
  assert.equal(canAccessRoute("hermes", "/config", "GET"), true);
  assert.equal(canAccessRoute("hermes", "/config", "POST"), false);
  assert.equal(canAccessRoute("server", "/config", "POST"), true);
});

test("a hermes token cannot claim admin through role or actor headers", async () => {
  const previousHermesToken = process.env.ORCHESTRA_HERMES_TOKEN;
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "token-role-ceiling-test-"));
  const configPath = path.join(repoRoot, ".ai-system.json");
  const originalConfig = JSON.stringify({
    auth: {
      role_mapping: { "root@example.com": "admin" },
      action_permissions: { "work_item.create": "admin", "config.update": "admin" }
    }
  });
  await fs.writeFile(configPath, originalConfig, "utf8");
  process.env.ORCHESTRA_HERMES_TOKEN = HERMES_TOKEN;

  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    authToken: SERVER_TOKEN,
    logger: silentLogger(),
    runner: async () => ({ ok: true } as any),
    allowedWorkdirs: [repoRoot]
  });

  try {
    const baseUrl = await listen(server);
    const hermes = { Authorization: `Bearer ${HERMES_TOKEN}` };

    const claimedRole = await requestJson(baseUrl, "POST", "/work-items", { title: "escalate" }, 403, {
      ...hermes,
      "x-ai-system-role": "admin"
    });
    assert.equal(claimedRole.ok, false);

    const claimedIdentity = await requestJson(baseUrl, "POST", "/work-items", { title: "escalate" }, 403, {
      ...hermes,
      "x-ai-system-actor": "root@example.com"
    });
    assert.equal(claimedIdentity.ok, false);

    // Writing config would plant a verification command the server runs.
    await requestJson(baseUrl, "POST", "/config", { tools: { commands: { test: { command: "sh", args: ["-c", "id"] } } } }, 403, {
      ...hermes,
      "x-ai-system-role": "admin"
    });
    assert.equal(await fs.readFile(configPath, "utf8"), originalConfig);

    // The server token is the root credential and keeps its header-selected role.
    const serverWrite = await requestJson(baseUrl, "POST", "/config", { max_iterations: 2 }, 200, {
      Authorization: `Bearer ${SERVER_TOKEN}`,
      "x-ai-system-role": "admin"
    });
    assert.equal(serverWrite.ok, true);
    assert.equal(serverWrite.config.max_iterations, 2);
  } finally {
    if (previousHermesToken === undefined) {
      delete process.env.ORCHESTRA_HERMES_TOKEN;
    } else {
      process.env.ORCHESTRA_HERMES_TOKEN = previousHermesToken;
    }
    await closeServer(server);
    await removeTempDir(repoRoot);
  }
});
