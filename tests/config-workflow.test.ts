import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { loadRules } from "../ai-system/core/orchestrator-runtime.js";
import { applySetupChoices, inspectProjectConfiguration, runSetupCheck, writeProjectPreset } from "../ai-system/core/config-workflow.js";

test("loadRules normalizes provider commands from a type-only .ai-system.json override", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));
  await fs.writeFile(
    path.join(repoRoot, ".ai-system.json"),
    JSON.stringify(
      {
        providers: {
          planner: { type: "codex-cli", timeout_ms: 0, retries: 2 },
          reviewer: { type: "codex-cli", timeout_ms: 0, retries: 2 },
          generator: { type: "codex-cli", timeout_ms: 0, retries: 2 },
          fixer: { type: "codex-cli", timeout_ms: 0, retries: 2 }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const { rules } = await loadRules(repoRoot);
    assert.equal(rules.providers.planner.type, "codex-cli");
    assert.equal(rules.providers.planner.command, "codex");
    assert.equal(rules.providers.reviewer.type, "codex-cli");
    assert.equal(rules.providers.reviewer.command, "codex");
    assert.equal(rules.providers.generator.type, "codex-cli");
    assert.equal(rules.providers.generator.command, "codex");
    assert.equal(rules.providers.fixer.type, "codex-cli");
    assert.equal(rules.providers.fixer.command, "codex");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadRules applies the codex-all preset from .ai-system.json", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));
  await fs.writeFile(path.join(repoRoot, ".ai-system.json"), JSON.stringify({ profile: "codex-all" }, null, 2), "utf8");

  try {
    const { rules, profile } = await loadRules(repoRoot);
    assert.equal(profile, "codex-all");
    assert.equal(rules.routing?.enabled, false);
    assert.equal(rules.providers.planner.command, "codex");
    assert.equal(rules.providers.reviewer.command, "codex");
    assert.equal(rules.providers.generator.command, "codex");
    assert.equal(rules.providers.fixer.command, "codex");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("writeProjectPreset preserves unrelated config and clears legacy provider overrides", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));
  const configPath = path.join(repoRoot, ".ai-system.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        memory: {
          enabled: true,
          backend: "openmemory"
        },
        routing: {
          enabled: true
        },
        providers: {
          planner: { type: "gemini-cli" }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const result = await writeProjectPreset({
      repoRoot,
      preset: "codex-all"
    });

    assert.equal(result.configPath, configPath);
    assert.equal(result.config.profile, "codex-all");
    assert.deepEqual(result.config.memory, { enabled: true, backend: "openmemory" });
    assert.equal("providers" in result.config, false);
    assert.equal("routing" in result.config, false);

    const inspection = await inspectProjectConfiguration({ repoRoot });
    assert.equal(inspection.profile, "codex-all");
    assert.equal(inspection.effectiveRules.providers.planner.command, "codex");
    assert.equal(inspection.effectiveRules.memory.backend, "openmemory");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadRules applies global config defaults before project overrides", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));
  const globalConfigPath = path.join(repoRoot, "global-config.json");
  await fs.writeFile(
    globalConfigPath,
    JSON.stringify(
      {
        providers: {
          planner: { type: "codex-cli" },
          reviewer: { type: "claude-cli" },
          generator: { type: "codex-cli" },
          fixer: { type: "codex-cli" }
        },
        routing: {
          enabled: false
        },
        memory: {
          enabled: true,
          backend: "openmemory"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(repoRoot, ".ai-system.json"),
    JSON.stringify(
      {
        providers: {
          reviewer: { type: "gemini-cli" }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const { rules, globalConfigPath: resolvedGlobalConfigPath, configPath } = await loadRules(repoRoot, null, globalConfigPath);
    assert.equal(resolvedGlobalConfigPath, globalConfigPath);
    assert.equal(configPath, path.join(repoRoot, ".ai-system.json"));
    assert.equal(rules.providers.planner.type, "codex-cli");
    assert.equal(rules.providers.reviewer.type, "gemini-cli");
    assert.equal(rules.providers.generator.type, "codex-cli");
    assert.equal(rules.memory.backend, "openmemory");
    assert.equal(rules.routing?.enabled, false);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadRules can inspect the global layer without mixing in project overrides", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));
  const globalConfigPath = path.join(repoRoot, "global-config.json");
  await fs.writeFile(
    globalConfigPath,
    JSON.stringify(
      {
        providers: {
          planner: { type: "codex-cli" },
          reviewer: { type: "claude-cli" }
        },
        routing: {
          enabled: false
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(repoRoot, ".ai-system.json"),
    JSON.stringify(
      {
        providers: {
          reviewer: { type: "gemini-cli" }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const { rules, configPath, globalConfigPath: resolvedGlobalConfigPath } = await loadRules(repoRoot, null, globalConfigPath, true);
    assert.equal(configPath, null);
    assert.equal(resolvedGlobalConfigPath, globalConfigPath);
    assert.equal(rules.providers.planner.type, "codex-cli");
    assert.equal(rules.providers.reviewer.type, "claude-cli");
    assert.equal(rules.routing?.enabled, false);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("applySetupChoices writes codex/openmemory project defaults and env values", async () => {
  await withEnv({}, async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));

    try {
      await applySetupChoices({
        repoRoot,
        choices: {
          providers: {
            planner: "auto",
            reviewer: "gemini-cli",
            generator: "codex-cli",
            fixer: "claude-cli"
          },
          routingEnabled: true,
          memoryBackend: "openmemory",
          openMemoryBaseUrl: "http://127.0.0.1:19080",
          openMemoryApiKey: "test-openmemory-key",
          tools: {
            lint: {
              mode: "script",
              script: "lint:changed",
              appendChangedFiles: true
            },
            typecheck: {
              mode: "auto",
              appendChangedFiles: false
            },
            build: {
              mode: "disabled"
            },
            test: {
              mode: "script",
              script: "test:changed",
              appendChangedFiles: true
            }
          }
        }
      });

      const config = JSON.parse(await fs.readFile(path.join(repoRoot, ".ai-system.json"), "utf8")) as Record<string, unknown>;
      const envRaw = await fs.readFile(path.join(repoRoot, ".env"), "utf8");

      assert.equal("profile" in config, false);
      assert.deepEqual(config.providers, {
        reviewer: { type: "gemini-cli" },
        generator: { type: "codex-cli" },
        fixer: { type: "claude-cli" }
      });
      assert.deepEqual(config.routing, {
        enabled: true
      });
      assert.deepEqual(config.memory, {
        enabled: true,
        backend: "openmemory"
      });
      assert.deepEqual(config.tools, {
        enabled: true,
        json_validation: true,
        commands: {
          lint: {
            enabled: true,
            script: "lint:changed",
            append_changed_files: true
          },
          typecheck: {
            enabled: true
          },
          build: {
            enabled: false
          },
          test: {
            enabled: true,
            script: "test:changed",
            append_changed_files: true
          }
        }
      });
      assert.match(envRaw, /AI_SYSTEM_OPENMEMORY_BASE_URL=http:\/\/127\.0\.0\.1:19080/);
      assert.match(envRaw, /AI_SYSTEM_OPENMEMORY_API_KEY=test-openmemory-key/);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("runSetupCheck reports OpenMemory probe failures against the configured env", async () => {
  await withEnv({}, async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));

    try {
      await applySetupChoices({
        repoRoot,
        choices: {
          providers: {
            planner: "auto",
            reviewer: "claude-cli",
            generator: "codex-cli",
            fixer: "codex-cli"
          },
          routingEnabled: true,
          memoryBackend: "openmemory",
          openMemoryBaseUrl: "http://127.0.0.1:9",
          openMemoryApiKey: "test-key"
        }
      });

      const result = await runSetupCheck({
        repoRoot,
        explicitGlobalConfigPath: path.join(repoRoot, "missing-global-config.json")
      });
      assert.equal(result.inspection.profile, null);
      assert.equal(result.inspection.effectiveRules.providers.planner.type, "gemini-cli");
      assert.equal(result.inspection.effectiveRules.providers.reviewer.type, "claude-cli");
      assert.equal(result.inspection.effectiveRules.routing?.enabled, true);
      assert.ok(result.inspection.toolSummaries.some((entry) => entry.name === "lint"));
      assert.equal(result.openmemory.enabled, true);
      if (result.openmemory.enabled) {
        assert.equal(result.openmemory.health.ok, false);
        assert.equal(result.openmemory.query.ok, false);
        assert.equal(result.openmemory.add.ok, false);
      }
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("runSetupCheck includes runtime, server, and dashboard prerequisites", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));
  await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify({
    scripts: { "dashboard:build": "true" }
  }), "utf8");

  const originalServerToken = process.env.AI_SYSTEM_SERVER_TOKEN;
  const originalAllowedWorkdirs = process.env.AI_SYSTEM_ALLOWED_WORKDIRS;
  const originalServerMode = process.env.AI_SYSTEM_SERVER_MODE;

  try {
    process.env.AI_SYSTEM_SERVER_TOKEN = "test-token";
    process.env.AI_SYSTEM_ALLOWED_WORKDIRS = `${repoRoot},/non-existent-path`;
    process.env.AI_SYSTEM_SERVER_MODE = "true";

    const result = await runSetupCheck({ repoRoot });

    assert.ok(result.inspection.runtime.nodeVersion.startsWith("v"));
    assert.ok(typeof result.inspection.runtime.pnpmVersion === "string" || result.inspection.runtime.pnpmVersion === null);
    assert.equal(result.inspection.server.tokenSet, true);
    assert.equal(result.inspection.server.allowedWorkdirs.length, 2);
    assert.equal(result.inspection.server.allowedWorkdirs[0].path, repoRoot);
    assert.equal(result.inspection.server.allowedWorkdirs[0].exists, true);
    assert.equal(result.inspection.server.allowedWorkdirs[0].absolute, true);
    assert.equal(result.inspection.server.allowedWorkdirs[1].exists, false);
    assert.equal(result.inspection.dashboard.buildScriptExists, true);
    assert.ok("pnpm" in result.cliAvailability);
  } finally {
    process.env.AI_SYSTEM_SERVER_TOKEN = originalServerToken;
    process.env.AI_SYSTEM_ALLOWED_WORKDIRS = originalAllowedWorkdirs;
    process.env.AI_SYSTEM_SERVER_MODE = originalServerMode;
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("project-configured providers stay pinned while auto roles remain routable", async () => {
  await withEnv({}, async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-config-"));
    await fs.writeFile(
      path.join(repoRoot, ".ai-system.json"),
      JSON.stringify(
        {
          providers: {
            reviewer: { type: "claude-cli" },
            generator: { type: "codex-cli" }
          },
          routing: {
            enabled: true
          }
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      const inspection = await inspectProjectConfiguration({
        repoRoot,
        explicitGlobalConfigPath: path.join(repoRoot, "missing-global-config.json"),
        task: "Update README wording and docs text"
      });

      assert.equal(inspection.effectiveRules.providers.reviewer.type, "claude-cli");
      assert.equal(inspection.effectiveRules.providers.generator.type, "codex-cli");
      assert.equal(inspection.effectiveRules.providers.planner.type, "gemini-cli");
      assert.equal(inspection.effectiveRules.providers.fixer.type, "codex-cli");
      assert.ok(inspection.toolSummaries.length >= 4);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

async function withEnv(env: Record<string, string | undefined>, callback: () => Promise<void>): Promise<void> {
  const keys = ["AI_SYSTEM_OPENMEMORY_BASE_URL", "AI_SYSTEM_OPENMEMORY_API_KEY", "AI_SYSTEM_MEMORY"];
  const baseline = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }
    await callback();
  } finally {
    for (const key of keys) {
      const previous = baseline.get(key);
      if (typeof previous === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}
