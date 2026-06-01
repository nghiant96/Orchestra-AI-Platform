import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { resolveApprovalPolicy } from "../ai-system/core/risk-policy.js";
import {
  applyWorkflowProfileToTask,
  buildWorkflowEvidenceChecklist,
  parseWorkflowProfileId,
  tightenApprovalPolicyForProfile
} from "../ai-system/workflows/workflow-registry.js";

describe("workflow profiles", () => {
  test("superpowers tightens but does not weaken approval policy", () => {
    const base = resolveApprovalPolicy("touch a docs file", { skip_approval: true } as any);
    assert.equal(base.approvalMode, "auto");

    const tightened = tightenApprovalPolicyForProfile(base, "superpowers");
    assert.equal(tightened.approvalMode, "manual");
    assert.equal(tightened.interactive, true);
    assert.equal(tightened.pauseAfterPlan, true);
    assert.equal(tightened.pauseAfterGenerate, true);
    assert.equal(tightened.riskClass, "high");
    assert.ok(tightened.signals.some((signal) => signal.name === "workflow-profile-superpowers"));
  });

  test("profile prompt injection is idempotent", () => {
    const once = applyWorkflowProfileToTask("Implement the task", "superpowers");
    const twice = applyWorkflowProfileToTask(once, "superpowers");
    assert.equal(twice, once);
    assert.match(once, /Hermes Superpowers method/);
  });

  test("superpowers evidence checklist is generated", () => {
    assert.equal(parseWorkflowProfileId("superpowers"), "superpowers");
    const checklist = buildWorkflowEvidenceChecklist("superpowers");
    assert.ok(checklist.some((item) => item.id === "workflow-superpowers-plan-artifact"));
    assert.ok(checklist.every((item) => item.evidence?.metadata?.workflowProfile === "superpowers"));
  });
});
