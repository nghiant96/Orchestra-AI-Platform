import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { 
  createExecutionStateMachine,
  loadImplementationMemoryContext 
} from "../ai-system/core/run-executor.js";

import { createLogger } from "../ai-system/utils/logger.js";

describe("Run Executor Core", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("createExecutionStateMachine initializes correctly", () => {
    let persisted = false;
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
      formatForPrompt: (matches: any[]) => matches.map(m => m.content).join("\n")
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
});
