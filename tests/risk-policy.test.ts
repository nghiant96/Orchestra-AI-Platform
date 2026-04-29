import test from "node:test";
import assert from "node:assert/strict";
import { resolveApprovalPolicy } from "../ai-system/core/risk-policy.js";

test("approval policy permits skip_approval auto-run for standard tasks", () => {
  const decision = resolveApprovalPolicy("Polish dashboard spacing", { skip_approval: true } as any);

  assert.equal(decision.riskClass, "low");
  assert.equal(decision.approvalMode, "auto");
  assert.equal(decision.interactive, false);
  assert.equal(decision.pauseAfterPlan, false);
});

test("approval policy auto-runs low-risk tasks with standard checks by default", () => {
  const decision = resolveApprovalPolicy("Polish dashboard copy", {} as any);

  assert.equal(decision.riskClass, "low");
  assert.equal(decision.approvalMode, "auto");
  assert.equal(decision.interactive, false);
});

test("approval policy escalates high-risk queue changes", () => {
  const decision = resolveApprovalPolicy("Fix queue approval lifecycle", {} as any, ["ai-system/core/job-queue.ts"]);

  assert.equal(decision.riskClass, "high");
  assert.equal(decision.approvalMode, "manual");
  assert.equal(decision.pauseAfterPlan, true);
  assert.equal(decision.pauseAfterGenerate, true);
  assert.ok(decision.signals.some((signal) => signal.name === "critical-path"));
});

test("approval policy scores broad and large generated changes", () => {
  const decision = resolveApprovalPolicy("Update generated UI files", {} as any, ["dashboard/src/A.tsx"], {
    generatedFileCount: 9,
    diffLineEstimate: 300
  });

  assert.equal(decision.riskClass, "high");
  assert.ok(decision.signals.some((signal) => signal.name === "large-diff"));
  assert.ok(decision.signals.some((signal) => signal.name === "broad-file-scope"));
});

test("approval policy blocks security-sensitive tasks even with skip_approval", () => {
  const decision = resolveApprovalPolicy("Update secret token permissions", { skip_approval: true } as any);

  assert.equal(decision.riskClass, "blocked");
  assert.equal(decision.approvalMode, "manual");
  assert.equal(decision.interactive, true);
});
