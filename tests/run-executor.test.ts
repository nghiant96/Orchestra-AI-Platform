import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createExecutionStateMachine,
  executeGenerationLoop,
  findMissingPlannedWriteTargets,
  loadImplementationMemoryContext,
  sanitizeGeneratedFiles,
  shouldUseStrictReview
} from "../ai-system/core/run-executor.js";
import { createArtifactState } from "../ai-system/core/artifacts.js";
import { createLogger } from "../ai-system/utils/logger.js";

describe("Run Executor Core", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("createExecutionStateMachine initializes correctly", () => {
    const mockArtifactState: any = {
      runDir: "/mock",
      latestIterationPath: null,
      contextPath: null,
      planPath: null,
      memoryPath: null,
      runId: "run-1"
    };

    const machine = createExecutionStateMachine(mockArtifactState);
    assert.equal(machine.getSteps().length, 0);
    assert.equal(machine.getTransitions().length, 0);
  });

  it("loadImplementationMemoryContext formats memory matches", async () => {
    const memoryMock: any = {
      searchRelevant: async () => [{ content: "match 1" }, { content: "match 2" }],
      formatForPrompt: (matches: any[]) => matches.map((m) => m.content).join("\n")
    };

    const loggerMock: any = createLogger({ verbose: false });

    const stats = { readFiles: 0, readBytes: 0, implementationMatches: 0 };
    const result = await loadImplementationMemoryContext(
      memoryMock,
      "fix bug",
      { prompt: "fix bug", readFiles: [], writeTargets: [], notes: [] },
      stats as any,
      loggerMock
    );

    assert.equal(stats.implementationMatches, 2);
    assert.equal(result, "match 1\nmatch 2");
  });

  it("sanitizeGeneratedFiles permits updates to planned read files", () => {
    const plan = {
      prompt: "Polish Event Feed filters",
      readFiles: ["dashboard/src/App.tsx"],
      writeTargets: ["dashboard/src/components/EventFeed.tsx"],
      notes: []
    };
    const files = [
      { path: "dashboard/src/App.tsx", action: "update", content: "export const App = null;\n" },
      { path: "dashboard/src/Outside.tsx", action: "update", content: "unexpected\n" }
    ];

    const result = sanitizeGeneratedFiles(files, plan, { max_write_files: 8 } as any, process.cwd());

    assert.deepEqual(
      result.map((file) => file.path),
      ["dashboard/src/App.tsx"]
    );
  });

  it("findMissingPlannedWriteTargets reports write targets that were not generated", () => {
    const plan = {
      prompt: "Split a small component",
      readFiles: ["src/input.ts"],
      writeTargets: ["src/one.ts", "src/two.ts"],
      notes: []
    };
    const files = [
      { path: "src/one.ts", action: "create", content: "export const one = 1;\n" }
    ];

    assert.deepEqual(findMissingPlannedWriteTargets(files as any, plan as any), ["src/two.ts"]);
  });

  it("executeGenerationLoop skips tool checks until every planned write target exists", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-loop-gate-"));
    const order: string[] = [];
    let fixerCalls = 0;

    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "loop-gate", private: true, version: "1.0.0" }, null, 2),
        "utf8"
      );
      await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
      await fs.writeFile(path.join(repoRoot, "src", "input.ts"), "export const input = 1;\n", "utf8");

      const rules: any = {
        max_iterations: 3,
        max_write_files: 8,
        max_files: 8,
        tools: {
          enabled: true,
          json_validation: false,
          commands: {
            lint: {
              enabled: true,
              command: "node",
              args: ["-e", "process.exit(0)"]
            }
          }
        },
        artifacts: {
          enabled: true,
          data_dir: ".ai-system-artifacts"
        }
      };

      const artifactState = createArtifactState(repoRoot, rules);
      const logger = createLogger({ verbose: false });
      const runtime: any = {
        plannerProvider: { id: "planner" },
        reviewerProvider: { id: "reviewer" },
        generatorProvider: { id: "generator" },
        fixerProvider: { id: "fixer" },
        providerSummary: { planner: "planner", reviewer: "reviewer", generator: "generator", fixer: "fixer" },
        planner: { planTask: async () => ({ prompt: "task", readFiles: [], writeTargets: [], notes: [] }) },
        reviewer: {
          reviewCode: async () => {
            order.push("reviewer");
            return { summary: "ok", issues: [], missingTests: [] };
          }
        },
        generator: {
          generateCode: async () => {
            order.push("generator");
            return {
              summary: "partial",
              files: [
                { path: "src/one.ts", action: "create", content: "export const one = 1;\n" }
              ]
            };
          }
        },
        fixer: {
          fixCode: async () => {
            fixerCalls += 1;
            order.push("fixer");
            return {
              summary: "complete",
              files: [
                { path: "src/one.ts", action: "create", content: "export const one = 1;\n" },
                { path: "src/two.ts", action: "create", content: "export const two = 2;\n" }
              ]
            };
          }
        },
        memory: {
          id: "memory",
          searchRelevant: async () => [],
          formatForPrompt: () => "",
          storeRunSummary: async () => true
        }
      };

      const toolChecks = async () => {
        order.push("tool-check");
        if (fixerCalls === 0) {
          throw new Error("tool checks ran before the incomplete generation was repaired");
        }
        return { results: [], issues: [] };
      };

      try {
        const loop = await executeGenerationLoop({
          startIteration: 1,
          task: "Split a small component",
          dryRun: false,
          pauseAfterPlan: false,
          pauseAfterGenerate: false,
          repoRoot,
          configPath: null,
          plan: {
            prompt: "Split a small component",
            readFiles: ["src/input.ts"],
            writeTargets: ["src/one.ts", "src/two.ts"],
            notes: []
          },
          skippedFiles: [],
          implementationMemoryContext: "",
          runtime,
          memoryStats: { backend: "disabled", planningMatches: 0, implementationMatches: 0, stored: false },
          artifactState,
          initialState: {
            currentResult: null,
            acceptedIssues: [],
            latestReviewSummary: "",
            iterationResults: [],
            latestToolResults: [],
            executionMachine: createExecutionStateMachine(artifactState, null, logger)
          },
          contextFiles: [{ path: "src/input.ts", content: "export const input = 1;\n" }],
          rules,
          logger,
          confirmCheckpoint: async () => true,
          successPersistedStatus: "completed",
          toolChecks
        });

        assert.ok(loop.result);
        assert.equal(loop.result?.ok, true);
        assert.deepEqual(order, ["generator", "fixer", "tool-check", "reviewer"]);
        assert.equal(fixerCalls, 1);
        assert.equal(await fs.readFile(path.join(repoRoot, "src", "two.ts"), "utf8"), "export const two = 2;\n");
      } finally {
        // mock.restoreAll() runs in afterEach; this block keeps the temp repo cleanup scoped to the test.
      }
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("shouldUseStrictReview only enables strict review for high-risk policy decisions", () => {
    const basePolicy = {
      riskScore: 0,
      signals: [],
      approvalMode: "manual" as const,
      interactive: true,
      pauseAfterPlan: false,
      pauseAfterGenerate: false,
      reason: "test policy"
    };

    assert.equal(shouldUseStrictReview(null), false);
    assert.equal(shouldUseStrictReview({ ...basePolicy, riskClass: "low" }), false);
    assert.equal(shouldUseStrictReview({ ...basePolicy, riskClass: "medium" }), false);
    assert.equal(shouldUseStrictReview({ ...basePolicy, riskClass: "high" }), true);
    assert.equal(shouldUseStrictReview({ ...basePolicy, riskClass: "blocked" }), false);
  });
});
