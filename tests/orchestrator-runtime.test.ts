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

test("adaptive routing uses recent general run outcomes to favor the safer implementation reviewer", async () => {
  await withEnv({}, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T10-00-00-000Z-a11111",
      status: "completed",
      task: "Refactor shared service helpers",
      providers: {
        planner: "gemini-cli",
        reviewer: "claude-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["src/shared/service.ts"]
    });
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T10-05-00-000Z-a22222",
      status: "completed",
      task: "Refactor shared service helpers",
      providers: {
        planner: "gemini-cli",
        reviewer: "claude-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["src/shared/service.ts"]
    });
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T10-10-00-000Z-a33333",
      status: "failed",
      task: "Refactor shared service helpers",
      providers: {
        planner: "gemini-cli",
        reviewer: "gemini-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["src/shared/service.ts"],
      issueCounts: { high: 0, medium: 1, low: 0 },
      failureClass: "review-blocking-issues"
    });
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T10-15-00-000Z-a44444",
      status: "failed",
      task: "Refactor shared service helpers",
      providers: {
        planner: "gemini-cli",
        reviewer: "gemini-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["src/shared/service.ts"],
      issueCounts: { high: 0, medium: 1, low: 0 },
      failureClass: "tool-check-failed"
    });

    const decision = await buildRoutingDecision({
      repoRoot,
      rules,
      task: "Refactor shared service helpers",
      stage: "implementation",
      plan: {
        prompt: "Refactor shared service helpers",
        readFiles: ["src/shared/service.ts"],
        writeTargets: ["src/shared/service.ts"],
        notes: []
      }
    });

    try {
      assert.equal(decision.profile, "safe");
      assert.equal(decision.roleProviders.reviewer, "claude-cli");
      assert.ok(decision.signals.some((signal) => signal.name === "history:provider-outcomes"));
      assert.match(decision.reason, /adaptive routing/i);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("adaptive routing favors the fast profile when recent docs reviews succeed with codex", async () => {
  await withEnv({}, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T11-00-00-000Z-b11111",
      status: "completed",
      task: "Update docs wording",
      providers: {
        planner: "gemini-cli",
        reviewer: "codex-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["README.md"]
    });
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T11-05-00-000Z-b22222",
      status: "completed",
      task: "Fix README typo",
      providers: {
        planner: "gemini-cli",
        reviewer: "codex-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["docs/guide.md"]
    });
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T11-10-00-000Z-b33333",
      status: "failed",
      task: "Update docs wording",
      providers: {
        planner: "gemini-cli",
        reviewer: "gemini-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["README.md"],
      issueCounts: { high: 0, medium: 1, low: 0 },
      failureClass: "review-blocking-issues"
    });

    const decision = await buildRoutingDecision({
      repoRoot,
      rules,
      task: "Update documentation wording",
      stage: "implementation",
      plan: {
        prompt: "Update documentation wording",
        readFiles: ["README.md"],
        writeTargets: ["README.md"],
        notes: []
      }
    });

    try {
      assert.equal(decision.profile, "fast");
      assert.equal(decision.roleProviders.reviewer, "codex-cli");
      assert.ok(decision.signals.some((signal) => signal.name === "history:provider-outcomes"));
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});

test("adaptive routing penalizes slower and costlier reviewers when quality is otherwise equal", async () => {
  await withEnv({}, async () => {
    const rules = createRules();
    const repoRoot = await createTempRepo();
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T12-00-00-000Z-c11111",
      status: "completed",
      task: "Refactor shared service helpers",
      providers: {
        planner: "gemini-cli",
        reviewer: "claude-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["src/shared/service.ts"],
      providerMetrics: [
        { provider: "claude-cli", role: "reviewer", totalDurationMs: 9000, estimatedCostUnits: 12 }
      ]
    });
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T12-05-00-000Z-c22222",
      status: "completed",
      task: "Refactor shared service helpers",
      providers: {
        planner: "gemini-cli",
        reviewer: "gemini-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["src/shared/service.ts"],
      providerMetrics: [
        { provider: "gemini-cli", role: "reviewer", totalDurationMs: 1200, estimatedCostUnits: 1.5 }
      ]
    });
    await seedAdaptiveRun(repoRoot, rules, {
      runName: "run-2026-04-23T12-10-00-000Z-c33333",
      status: "completed",
      task: "Refactor shared service helpers",
      providers: {
        planner: "gemini-cli",
        reviewer: "gemini-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
      },
      latestFiles: ["src/shared/service.ts"],
      providerMetrics: [
        { provider: "gemini-cli", role: "reviewer", totalDurationMs: 1000, estimatedCostUnits: 1.4 }
      ]
    });

    const decision = await buildRoutingDecision({
      repoRoot,
      rules,
      task: "Refactor shared service helpers",
      stage: "implementation",
      plan: {
        prompt: "Refactor shared service helpers",
        readFiles: ["src/shared/service.ts"],
        writeTargets: ["src/shared/service.ts"],
        notes: []
      }
    });

    try {
      assert.equal(decision.roleProviders.reviewer, "gemini-cli");
      assert.ok(decision.signals.some((signal) => signal.name === "history:provider-outcomes"));
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

async function seedAdaptiveRun(
  repoRoot: string,
  rules: RulesConfig,
  {
    runName,
    status,
    task,
    providers,
    latestFiles,
    issueCounts = { high: 0, medium: 0, low: 0 },
    failureClass = null,
    providerMetrics = []
  }: {
    runName: string;
    status: string;
    task: string;
    providers: Record<string, string>;
    latestFiles: string[];
    issueCounts?: Record<string, number>;
    failureClass?: string | null;
    providerMetrics?: Array<{ provider: string; role: "planner" | "reviewer" | "generator" | "fixer"; totalDurationMs: number; estimatedCostUnits: number }>;
  }
): Promise<void> {
  const runDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts", runName);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "run-state.json"),
    JSON.stringify(
      {
        status,
        task,
        providers,
        issueCounts,
        result: {
          files: latestFiles.map((file) => ({ path: file }))
        },
        execution: {
          totalDurationMs: 100,
          steps: [],
          providerMetrics,
          failure: failureClass ? { class: failureClass, reason: failureClass } : null
        }
      },
      null,
      2
    ),
    "utf8"
  );
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
