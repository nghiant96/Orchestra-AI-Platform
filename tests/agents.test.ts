import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PlannerAgent, PLAN_SCHEMA } from "../ai-system/agents/planner.js";
import { GeneratorAgent } from "../ai-system/agents/generator.js";

describe("Agents Core", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("PlannerAgent constructs proper prompts and calls provider", async () => {
    const mockProvider: any = {
      runJson: mock.fn(async (_args: any) => {
        return {
          prompt: "fix bug",
          readFiles: ["src/index.ts"],
          writeTargets: ["src/index.ts"],
          notes: []
        };
      })
    };

    const rules: any = {
      max_files: 5,
      request_timeout_ms: 5000,
      request_retries: 2,
      retry_base_delay_ms: 100
    };

    const planner = new PlannerAgent({ provider: mockProvider, rules });
    const result = await planner.planTask("fix bug", "src/index.ts", "/mock", "Memory: None");

    assert.equal(mockProvider.runJson.mock.callCount(), 1);
    const callArgs = mockProvider.runJson.mock.calls[0].arguments[0];
    
    assert.ok(callArgs.systemPrompt.includes("Select at most 5 existing files"));
    assert.ok(callArgs.prompt.includes("Task: fix bug"));
    assert.ok(callArgs.prompt.includes("Memory: None"));
    assert.deepEqual(callArgs.schema, PLAN_SCHEMA);
    
    assert.equal(result.prompt, "fix bug");
  });

  it("GeneratorAgent constructs proper prompts for candidate generation", async () => {
    const mockProvider: any = {
      runJson: mock.fn(async (_args: any) => {
        return {
          files: [{ path: "src/index.ts", action: "update", content: "fixed" }],
          summary: "Did stuff"
        };
      })
    };

    const rules: any = {
      max_write_files: 3,
      request_timeout_ms: 5000,
      request_retries: 2,
      retry_base_delay_ms: 100
    };

    const generator = new GeneratorAgent({ provider: mockProvider, rules });
    const plan = { prompt: "fix bug", readFiles: ["src/index.ts"], writeTargets: ["src/index.ts"], notes: [] };
    const result = await generator.generateCode(
      "fix bug",
      plan,
      [{ path: "src/index.ts", content: "" }], // contextFiles
      "/mock"
    );

    assert.equal(mockProvider.runJson.mock.callCount(), 1);
    const callArgs = mockProvider.runJson.mock.calls[0].arguments[0];
    
    assert.ok(callArgs.systemPrompt.includes("You are a code generation agent."));
    assert.ok(callArgs.prompt.includes("fix bug"));
    assert.equal(result.files[0].path, "src/index.ts");
  });
});
