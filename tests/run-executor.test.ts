import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createExecutionStateMachine,
  loadImplementationMemoryContext,
  sanitizeGeneratedFiles,
  shouldUseStrictReview
} from "../ai-system/core/run-executor.js";

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
