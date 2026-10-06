import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createExecutionStateMachine, executeGenerationLoop } from "../ai-system/core/run-executor.js";
import { createArtifactState } from "../ai-system/core/artifacts.js";
import { silentLogger, removeTempDir } from "./test-utils.js";
import type { ReviewIssue } from "../ai-system/types.js";

/**
 * The panel is only worth anything if the real loop uses it. These tests drive
 * `executeGenerationLoop` end to end and assert on what the reviewer seat
 * actually did.
 */
describe("review panel inside the generation loop", () => {
  async function runLoop(options: {
    reviewPanel?: unknown;
    reviewFor: (lensId: string | undefined) => { summary: string; issues: ReviewIssue[] };
    onReview?: (lensId: string | undefined) => void;
  }) {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "review-panel-loop-"));
    try {
      await fs.writeFile(
        path.join(repoRoot, "package.json"),
        JSON.stringify({ name: "panel-loop", private: true, version: "1.0.0" }, null, 2),
        "utf8"
      );
      await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
      await fs.writeFile(path.join(repoRoot, "src", "input.ts"), "export const input = 1;\n", "utf8");

      const rules: any = {
        max_iterations: 1,
        max_write_files: 8,
        max_files: 8,
        tools: { enabled: false },
        artifacts: { enabled: true, data_dir: ".ai-system-artifacts" },
        review_panel: options.reviewPanel
      };

      const artifactState = createArtifactState(repoRoot, rules);
      const logger = silentLogger();
      const runtime: any = {
        plannerProvider: { id: "planner" },
        reviewerProvider: { id: "reviewer" },
        generatorProvider: { id: "generator" },
        fixerProvider: { id: "fixer" },
        providerSummary: { planner: "planner", reviewer: "reviewer", generator: "generator", fixer: "fixer" },
        planner: { planTask: async () => ({ prompt: "task", readFiles: [], writeTargets: [], notes: [] }) },
        reviewer: {
          // The tenth positional parameter is the lens; capturing it is how we
          // tell a panel run from a single review.
          reviewCode: async (..._args: unknown[]) => {
            const lens = _args[10] as { id: string } | undefined;
            options.onReview?.(lens?.id);
            return options.reviewFor(lens?.id);
          }
        },
        generator: {
          generateCode: async () => ({
            summary: "generated",
            files: [{ path: "src/one.ts", action: "create", content: "export const one = 1;\n" }]
          })
        },
        fixer: {
          fixCode: async () => ({
            summary: "fixed",
            files: [{ path: "src/one.ts", action: "create", content: "export const one = 2;\n" }]
          })
        },
        memory: {
          id: "memory",
          searchRelevant: async () => [],
          formatForPrompt: () => "",
          storeRunSummary: async () => true
        }
      };

      const loop = await executeGenerationLoop({
        startIteration: 1,
        task: "Add a small module",
        dryRun: false,
        pauseAfterPlan: false,
        pauseAfterGenerate: false,
        repoRoot,
        configPath: null,
        plan: { prompt: "Add a small module", readFiles: ["src/input.ts"], writeTargets: ["src/one.ts"], notes: [] },
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
        toolChecks: async () => ({ results: [], issues: [] })
      });

      return loop;
    } finally {
      await removeTempDir(repoRoot);
    }
  }

  it("calls the reviewer once when no panel is configured", async () => {
    const seen: Array<string | undefined> = [];
    await runLoop({
      reviewPanel: undefined,
      onReview: (lensId) => seen.push(lensId),
      reviewFor: () => ({ summary: "clean", issues: [] })
    });

    assert.equal(seen.length, 1, "the default path must stay a single review");
    assert.equal(seen[0], undefined, "no lens should be passed when the panel is off");
  });

  it("calls one reviewer per lens when the panel is on", async () => {
    const seen: Array<string | undefined> = [];
    await runLoop({
      reviewPanel: { enabled: true, lenses: ["correctness", "security", "tests"], quorum: 2 },
      onReview: (lensId) => seen.push(lensId),
      reviewFor: () => ({ summary: "clean", issues: [] })
    });

    assert.equal(seen.length, 3, "each lens is its own reviewer call");
    assert.deepEqual([...seen].sort(), ["correctness", "security", "tests"]);
  });

  it("a finding two lenses agree on survives into the loop's review result", async () => {
    const loop = await runLoop({
      reviewPanel: { enabled: true, lenses: ["correctness", "security"], quorum: 2 },
      reviewFor: () => ({
        summary: "found it",
        issues: [{
          severity: "high",
          category: "shared",
          path: "src/one.ts",
          line: 1,
          description: "Unvalidated input",
          suggestedFix: "Validate it"
        }]
      })
    });

    // A blocking finding with only one iteration allowed leaves the loop
    // without a finalised result, so the accepted issues are the record.
    const issues = loop.state.acceptedIssues;
    const agreed = issues.find((entry) => entry.description.includes("Unvalidated input"));
    assert.ok(agreed, `expected the agreed finding, saw: ${JSON.stringify(issues)}`);
    assert.equal(agreed.severity, "high");
    assert.equal(agreed.agreement?.count, 2);
    assert.equal(agreed.agreement?.quorumMet, true);
  });

  it("a finding only one lens raises is reported but does not block the run", async () => {
    const loop = await runLoop({
      reviewPanel: { enabled: true, lenses: ["correctness", "security", "tests"], quorum: 2 },
      reviewFor: (lensId) =>
        lensId === "security"
          ? {
              summary: "one concern",
              issues: [{
                severity: "high",
                category: "security",
                path: "src/one.ts",
                line: 1,
                description: "Possible timing leak",
                suggestedFix: "Use a constant-time compare"
              }]
            }
          : { summary: "clean", issues: [] }
    });

    // A single dissenting lens raising "high" must not stall the pipeline, but
    // its finding still has to reach the operator.
    assert.equal(loop.result?.ok, true, "a minority finding should not fail the run");
    const issues = loop.result?.finalIssues ?? [];
    const advisory = issues.find((entry) => entry.description.includes("Possible timing leak"));
    assert.ok(advisory, "the minority finding must still be reported");
    assert.equal(advisory.severity, "low");
    assert.equal(advisory.agreement?.quorumMet, false);
  });

  it("survives a lens that throws", async () => {
    const loop = await runLoop({
      reviewPanel: { enabled: true, lenses: ["correctness", "security"], quorum: 1 },
      reviewFor: (lensId) => {
        if (lensId === "security") throw new Error("provider unavailable");
        return { summary: "clean", issues: [] };
      }
    });

    assert.ok(loop.result, "the run should complete on the surviving lens");
    assert.equal(loop.result?.ok, true);
  });
});
