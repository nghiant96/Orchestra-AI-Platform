import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { prepareRuntimeRules } from "../ai-system/core/orchestrator-runtime.js";
import { buildRoutingDecision } from "../ai-system/core/provider-router.js";
import type { Logger, RulesConfig } from "../ai-system/types.js";

test("prepareRuntimeRules routes low-risk text tasks to the fast profile", async () => {
  await withEnv({}, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    const decision = await prepareRuntimeRules({
      repoRoot,
      rules,
      task: "Update the README wording and fix a docs typo",
      stage: "planning",
      logger: silentLogger()
    });

    try {
      assert.equal(decision.profile, "fast");
      assert.equal(rules.providers.reviewer.type, "codex-cli");
      assert.equal(rules.providers.reviewer.command, "codex");
      assert.equal(rules.providers.generator.type, "codex-cli");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("prepareRuntimeRules routes risky tasks to the safe profile using provider templates", async () => {
  await withEnv({}, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo(["prisma/schema.prisma"]);
    const decision = await prepareRuntimeRules({
      repoRoot,
      rules,
      task: "Migrate the payment database schema for the auth service",
      stage: "planning",
      logger: silentLogger()
    });

    try {
      assert.equal(decision.profile, "safe");
      assert.equal(rules.providers.reviewer.type, "claude-cli");
      assert.equal(rules.providers.reviewer.command, "claude");
      assert.equal(rules.providers.planner.type, "gemini-cli");
      assert.equal(rules.providers.generator.type, "codex-cli");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("explicit role env overrides stay authoritative after dynamic routing", async () => {
  await withEnv({ AI_SYSTEM_REVIEWER_PROVIDER: "codex-cli" }, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    await prepareRuntimeRules({
      repoRoot,
      rules,
      task: "Rotate auth tokens in production",
      stage: "planning",
      logger: silentLogger()
    });
    try {
      const decision = await buildRoutingDecision({
        repoRoot,
        rules: createRules(),
        task: "Rotate auth tokens in production",
        stage: "planning"
      });
      assert.equal(decision.profile, "safe");
      assert.equal(rules.providers.reviewer.type, "codex-cli");
      assert.equal(rules.providers.reviewer.command, "codex");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("AI_SYSTEM_ROUTING_PROFILE forces the requested routing profile", async () => {
  await withEnv({ AI_SYSTEM_ROUTING_PROFILE: "safe" }, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    const decision = await prepareRuntimeRules({
      repoRoot,
      rules,
      task: "Fix a tiny README typo",
      stage: "planning",
      logger: silentLogger()
    });

    try {
      assert.equal(decision.profile, "safe");
      assert.equal(rules.providers.reviewer.type, "claude-cli");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("AI_SYSTEM_PROVIDER rebuilds all role configs from matching provider templates", async () => {
  await withEnv({ AI_SYSTEM_PROVIDER: "gemini-cli" }, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    await prepareRuntimeRules({
      repoRoot,
      rules,
      task: "Update a small README section",
      stage: "planning",
      logger: silentLogger()
    });

    try {
      assert.equal(rules.providers.planner.type, "gemini-cli");
      assert.equal(rules.providers.planner.command, "gemini");
      assert.equal(rules.providers.generator.type, "gemini-cli");
      assert.equal(rules.providers.generator.command, "gemini");
      assert.equal(rules.providers.fixer.type, "gemini-cli");
      assert.equal(rules.providers.fixer.command, "gemini");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("AI_SYSTEM_PROVIDER=default restores the mixed local provider commands", async () => {
  await withEnv({ AI_SYSTEM_PROVIDER: "default", AI_SYSTEM_ROUTING_ENABLED: "false" }, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    await prepareRuntimeRules({
      repoRoot,
      rules,
      task: "Update a small README section",
      stage: "planning",
      logger: silentLogger()
    });

    try {
      assert.equal(rules.providers.planner.type, "gemini-cli");
      assert.equal(rules.providers.planner.command, "gemini");
      assert.equal(rules.providers.reviewer.type, "gemini-cli");
      assert.equal(rules.providers.reviewer.command, "gemini");
      assert.equal(rules.providers.generator.type, "codex-cli");
      assert.equal(rules.providers.generator.command, "codex");
      assert.equal(rules.providers.fixer.type, "codex-cli");
      assert.equal(rules.providers.fixer.command, "codex");
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("implementation-stage routing upgrades reviewer when the plan targets risky paths", async () => {
  await withEnv({}, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo(["docker-compose.yml"]);
    const decision = await buildRoutingDecision({
      repoRoot,
      rules,
      task: "Refactor shared utilities",
      stage: "implementation",
      plan: {
        prompt: "Refactor shared utilities",
        readFiles: ["src/shared/util.ts"],
        writeTargets: ["src/auth/session.ts", "prisma/schema.prisma", "docker-compose.yml"],
        notes: []
      }
    });

    try {
      assert.equal(decision.profile, "safe");
      assert.equal(decision.roleProviders.reviewer, "claude-cli");
      assert.ok(decision.signals.some((signal) => signal.name === "plan:risky-paths"));
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

async function withEnv(env: Record<string, string>, callback: () => Promise<void>): Promise<void> {
  const keys = [
    "AI_SYSTEM_PROVIDER",
    "AI_SYSTEM_ROUTING_PROFILE",
    "AI_SYSTEM_RISK_PROFILE",
    "AI_SYSTEM_ROUTING_ENABLED",
    "AI_SYSTEM_REVIEWER_PROVIDER"
  ];
  const baseline = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    for (const key of keys) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
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

async function createTempRepo(files: string[] = []): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-routing-"));
  await Promise.all(
    files.map(async (filePath) => {
      const targetPath = path.join(repoRoot, filePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, "", "utf8");
    })
  );
  return repoRoot;
}

function createRules(): RulesConfig {
  return {
    max_iterations: 3,
    max_files: 5,
    max_write_files: 8,
    token_limit_hint: 12000,
    max_context_bytes: 60000,
    request_timeout_ms: 60000,
    request_retries: 3,
    retry_base_delay_ms: 500,
    artifacts: {
      enabled: true,
      data_dir: ".ai-system-artifacts"
    },
    memory: {
      enabled: false,
      backend: "local-file"
    },
    routing: {
      enabled: true,
      default_profile: "balanced",
      profiles: {
        fast: {
          planner: "gemini-cli",
          reviewer: "codex-cli",
          generator: "codex-cli",
          fixer: "codex-cli"
        },
        balanced: {
          planner: "gemini-cli",
          reviewer: "gemini-cli",
          generator: "codex-cli",
          fixer: "codex-cli"
        },
        safe: {
          planner: "gemini-cli",
          reviewer: "claude-cli",
          generator: "codex-cli",
          fixer: "codex-cli"
        }
      },
      heuristics: {
        fast: ["readme", "docs", "typo"],
        safe: ["auth", "payment", "database", "production"]
      }
    },
    providers: {
      planner: { type: "gemini-cli", command: "gemini", timeout_ms: 0, retries: 2, monitor_interval_ms: 0 },
      reviewer: { type: "gemini-cli", command: "gemini", timeout_ms: 0, retries: 2, monitor_interval_ms: 0 },
      generator: { type: "codex-cli", command: "codex", timeout_ms: 0, retries: 1, monitor_interval_ms: 0 },
      fixer: { type: "codex-cli", command: "codex", timeout_ms: 0, retries: 1, monitor_interval_ms: 0 },
      claude_fallback: { type: "claude-cli", command: "claude", timeout_ms: 0, retries: 1, monitor_interval_ms: 0 }
    }
  };
}

function silentLogger(): Logger {
  return {
    step() {},
    info() {},
    warn() {},
    error() {},
    success() {}
  };
}
