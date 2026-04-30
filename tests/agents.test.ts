import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PlannerAgent, PLAN_SCHEMA } from "../ai-system/agents/planner.js";
import { GeneratorAgent } from "../ai-system/agents/generator.js";
import { ReviewerAgent } from "../ai-system/agents/reviewer.js";

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
    assert.ok(callArgs.systemPrompt.includes("Few-Shot Example: Bug Fix"));
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
    assert.ok(callArgs.systemPrompt.includes("Few-Shot Example: Bug Fix"));
    assert.ok(callArgs.prompt.includes("fix bug"));
    assert.equal(result.files[0].path, "src/index.ts");
  });

  it("GeneratorAgent injects refactor examples and rejects files outside planned scope", async () => {
    const mockProvider: any = {
      runJson: mock.fn(async () => ({
        files: [{ path: "src/unplanned.ts", action: "update", content: "unexpected" }],
        summary: "Changed unplanned file"
      }))
    };
    const rules: any = {
      max_write_files: 3,
      request_timeout_ms: 5000,
      request_retries: 2,
      retry_base_delay_ms: 100
    };

    const generator = new GeneratorAgent({ provider: mockProvider, rules });
    const plan = { prompt: "refactor service", readFiles: ["src/index.ts"], writeTargets: ["src/index.ts"], notes: [] };

    await assert.rejects(
      () => generator.generateCode("refactor service", plan, [{ path: "src/index.ts", content: "" }], "/mock"),
      /outside the planned scope/
    );

    const callArgs = mockProvider.runJson.mock.calls[0].arguments[0];
    assert.ok(callArgs.systemPrompt.includes("Few-Shot Example: Refactor"));
  });

  it("ReviewerAgent records dropped invalid-path issues as validation notes", async () => {
    const mockProvider: any = {
      runJson: mock.fn(async () => ({
        summary: "Found issues",
        issues: [
          {
            severity: "medium",
            category: "correctness",
            path: "src/index.ts",
            description: "Valid scoped issue",
            suggestedFix: "Fix src/index.ts"
          },
          {
            severity: "medium",
            category: "correctness",
            path: "src/outside.ts",
            description: "Outside scoped issue",
            suggestedFix: "Do not report outside files"
          }
        ]
      }))
    };
    const rules: any = {
      request_timeout_ms: 5000,
      request_retries: 2,
      retry_base_delay_ms: 100
    };

    const reviewer = new ReviewerAgent({ provider: mockProvider, rules });
    const result = await reviewer.reviewCode(
      "review candidate",
      null,
      false,
      [{ path: "src/index.ts", content: "before" }],
      [{ path: "src/index.ts", content: "after" }],
      [],
      [],
      "/mock"
    );

    assert.equal(result.issues.length, 2);
    assert.equal(result.issues[0]?.path, "src/index.ts");
    assert.equal(result.issues[1]?.severity, "low");
    assert.equal(result.issues[1]?.category, "validation");
    assert.match(result.issues[1]?.description ?? "", /src\/outside\.ts/);
  });

  it("ReviewerAgent sends plan context and strict review instructions for high-risk reviews", async () => {
    const mockProvider: any = {
      runJson: mock.fn(async () => ({
        summary: "Strict review passed",
        issues: []
      }))
    };
    const rules: any = {
      request_timeout_ms: 5000,
      request_retries: 2,
      retry_base_delay_ms: 100
    };

    const reviewer = new ReviewerAgent({ provider: mockProvider, rules });
    const plan = {
      prompt: "update auth flow",
      readFiles: ["src/auth.ts"],
      writeTargets: ["src/auth.ts"],
      notes: ["Preserve security checks"],
      contracts: [
        {
          id: "security-auth-tests",
          description: "Security-sensitive auth changes require tests.",
          severity: "high",
          check: "test-required",
          status: "unknown"
        }
      ]
    };

    await reviewer.reviewCode(
      "review high-risk candidate",
      plan as any,
      true,
      [{ path: "src/auth.ts", content: "before" }],
      [{ path: "src/auth.ts", content: "after" }],
      [],
      [],
      "/mock"
    );

    const callArgs = mockProvider.runJson.mock.calls[0].arguments[0];
    assert.match(callArgs.systemPrompt, /HIGH-RISK task/);
    assert.match(callArgs.systemPrompt, /STRICT REVIEW/);

    const payload = JSON.parse(callArgs.prompt);
    assert.equal(payload.isStrict, true);
    assert.deepEqual(payload.plan, plan);
  });
});
