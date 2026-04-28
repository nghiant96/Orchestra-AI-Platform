import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionStateMachine } from "../ai-system/core/execution-state-machine.js";
import { buildExecutionSummary } from "../ai-system/core/execution-summary.js";

test("ExecutionStateMachine records explicit transitions and derives steps", async () => {
  const machine = new ExecutionStateMachine();

  const stage = await machine.runStage("planner", async () => ({ prompt: "task" }), {
    detail: "Planner provider: gemini-cli."
  });

  assert.equal(stage.result.prompt, "task");
  assert.equal(machine.getCurrentStage(), null);
  assert.deepEqual(
    machine.getTransitions().map((entry) => ({ stage: entry.stage, status: entry.status })),
    [
      { stage: "planner", status: "entered" },
      { stage: "planner", status: "completed" }
    ]
  );
  assert.deepEqual(machine.getSteps().map((entry) => entry.name), ["planner"]);
});

test("buildExecutionSummary exposes current and terminal stages from transitions", () => {
  const summary = buildExecutionSummary({
    status: "failed",
    transitions: [
      { stage: "planner", status: "entered", timestamp: "2026-01-01T00:00:00.000Z" },
      { stage: "planner", status: "completed", timestamp: "2026-01-01T00:00:01.000Z", durationMs: 1000 },
      { stage: "iteration-review", status: "entered", timestamp: "2026-01-01T00:00:02.000Z" },
      { stage: "iteration-review", status: "failed", timestamp: "2026-01-01T00:00:03.000Z", durationMs: 1000 }
    ],
    steps: [
      { name: "planner", durationMs: 1000, status: "completed" },
      { name: "iteration-review", durationMs: 1000, status: "failed" }
    ],
    finalIssues: [],
    latestToolResults: [],
    iterations: []
  });

  assert.equal(summary.currentStage, null);
  assert.equal(summary.terminalStage, "iteration-review");
  assert.equal(summary.totalDurationMs, 2000);
});

test("buildExecutionSummary uses provider usage cost while preserving duration metrics", () => {
  const summary = buildExecutionSummary({
    status: "failed",
    steps: [
      { name: "planner", durationMs: 1000, status: "completed" },
      { name: "iteration-review", durationMs: 2000, status: "completed" }
    ],
    providers: {
      planner: "gemini-cli",
      reviewer: "claude-cli",
      generator: "codex-cli",
      fixer: "codex-cli"
    },
    usageMetrics: [
      {
        role: "planner",
        provider: "gemini-cli",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        estimatedCostUnits: 0.025
      }
    ],
    budgetConfig: {
      max_cost_units: 0.02
    },
    finalIssues: [],
    latestToolResults: [],
    iterations: []
  });

  const providerMetrics = summary.providerMetrics ?? [];
  const plannerMetric = providerMetrics.find((metric) => metric.role === "planner");
  const reviewerMetric = providerMetrics.find((metric) => metric.role === "reviewer");

  assert.equal(plannerMetric?.estimatedCostUnits, 0.025);
  assert.equal(plannerMetric?.totalDurationMs, 1000);
  assert.equal(reviewerMetric?.estimatedCostUnits, 0);
  assert.equal(reviewerMetric?.totalDurationMs, 2000);
  assert.equal(summary.budget?.totalCostUnits, 0.025);
  assert.equal(summary.budget?.exceeded, "cost");
});
