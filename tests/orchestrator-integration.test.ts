import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Orchestrator } from "../ai-system/core/orchestrator.js";
import { createLogger } from "../ai-system/utils/logger.js";

describe("Orchestrator Integration", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("Orchestrator handles missing config file gracefully", async () => {
    mock.method(fs, "realpath", async (p: any) => String(p));
    mock.method(fs, "access", async () => {});

    const logger = createLogger({ verbose: false });
    const orchestrator = new Orchestrator({ repoRoot: "/mock", logger, configPath: "missing.json" });

    mock.method(fs, "readFile", async () => {
      throw new Error("ENOENT");
    });

    try {
      await orchestrator.run("test task", {
        dryRun: true
      });
      assert.fail("Should have thrown ENOENT");
    } catch (err: any) {
      assert.ok(err.message.includes("ENOENT"));
    }
  });

  it("Orchestrator performs refactor analysis in refactor mode", async () => {
    const os = await import("node:os");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-orchestrator-refactor-"));
    
    try {
      const logger = createLogger({ verbose: false });
      const orchestrator = new Orchestrator({ repoRoot: tempDir, logger });

      // Mock dependency graph build
      const { DependencyGraph } = await import("../ai-system/core/dependency-graph.js");
      mock.method(DependencyGraph.prototype, "buildGraph", async () => {});
      mock.method(DependencyGraph.prototype, "getRelatedFiles", async () => ["src/related.ts"]);

      // Mock planner runJson to return a plan
      const { PlannerAgent } = await import("../ai-system/agents/planner.js");
      mock.method(PlannerAgent.prototype, "planTask", async () => ({
        prompt: "refactor prompt",
        readFiles: ["src/a.ts"],
        writeTargets: ["src/b.ts"],
        notes: []
      }));

      const result = await orchestrator.run("refactor this", {
        workflowMode: "refactor",
        dryRun: true
      });

      assert.ok(result.plan.refactorAnalysis);
      assert.strictEqual(result.plan.refactorAnalysis.affectedFiles.length, 2); // b.ts + related.ts
      assert.ok(result.refactorAnalysis);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
