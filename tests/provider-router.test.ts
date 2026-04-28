import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildRoutingDecision,
  chooseProfile,
  resolveRoleProviders
} from "../ai-system/core/provider-router.js";
import type { RulesConfig } from "../ai-system/types.js";

const DEFAULT_RULES: RulesConfig = {
  providers: {
    planner: { type: "gemini-cli" },
    reviewer: { type: "codex-cli" },
    generator: { type: "claude-cli" },
    fixer: { type: "gemini-cli" }
  },
  routing: {
    enabled: true,
    default_profile: "balanced",
    adaptive: { enabled: false }
  }
} as RulesConfig;

describe("Provider Router Core", () => {
  beforeEach(() => {
    delete process.env.AI_SYSTEM_ROUTING_ENABLED;
    delete process.env.AI_SYSTEM_ROUTING_PROFILE;
    delete process.env.AI_SYSTEM_RISK_PROFILE;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("chooses profile correctly based on signals", () => {
    // Both fast and safe signals, safe has higher score 4 vs 3
    const winner = chooseProfile("balanced", [
      { name: "task:fast-keywords", matched: true, scores: { fast: 3 } },
      { name: "plan:risky-paths", matched: true, scores: { safe: 4 } }
    ]);
    assert.equal(winner, "safe");
  });

  it("resolves role providers correctly for implementation stage with docs-only signal", () => {
    const roleProviders = resolveRoleProviders(
      DEFAULT_RULES,
      "balanced",
      "implementation",
      null,
      [{ name: "plan:docs-only", matched: true }]
    );
    // Profile balanced default reviewer is gemini-cli, but docs-only forces codex-cli if available
    // Assuming our rules has codex-cli
    assert.equal(roleProviders.reviewer, "codex-cli");
  });

  it("buildRoutingDecision detects disabled routing", async () => {
    mock.method(fs, "access", async () => {
      throw new Error("enoent");
    });

    const decision = await buildRoutingDecision({
      repoRoot: "/mock",
      rules: { ...DEFAULT_RULES, routing: { enabled: false } },
      stage: "planning"
    });
    assert.equal(decision.enabled, false);
    assert.equal(decision.profile, "balanced");
  });

  it("buildRoutingDecision uses safe profile for risky tasks", async () => {
    mock.method(fs, "access", async () => {
      throw new Error("enoent");
    });

    const decision = await buildRoutingDecision({
      repoRoot: "/mock",
      rules: DEFAULT_RULES,
      task: "update payment database schema",
      stage: "planning"
    });
    
    assert.equal(decision.enabled, true);
    assert.equal(decision.profile, "safe");
    assert.ok(decision.reasons.some((r) => r.includes("high-risk keywords")));
  });

  it("buildRoutingDecision parses file system repo signals", async () => {
    mock.method(fs, "access", async (pathLike: string) => {
      if (String(pathLike).includes("docker-compose.yml")) {
        return;
      }
      throw new Error("enoent");
    });

    const decision = await buildRoutingDecision({
      repoRoot: "/mock",
      rules: DEFAULT_RULES,
      stage: "planning"
    });
    
    assert.ok(decision.signals.some((s) => s.name === "repo:docker-compose"));
  });
});
