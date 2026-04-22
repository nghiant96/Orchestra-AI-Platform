import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkflowModeDefaults } from "../ai-system/core/workflow-modes.js";

test("review workflow defaults to dry-run review checkpoints", () => {
  const flags = applyWorkflowModeDefaults("review");
  assert.deepEqual(flags, {
    dryRun: true,
    interactive: true,
    pauseAfterPlan: false,
    pauseAfterGenerate: true
  });
});

test("fix workflow defaults to interactive write-enabled execution", () => {
  const flags = applyWorkflowModeDefaults("fix");
  assert.deepEqual(flags, {
    dryRun: false,
    interactive: true,
    pauseAfterPlan: false,
    pauseAfterGenerate: false
  });
});

test("explicit CLI flags override workflow defaults", () => {
  const flags = applyWorkflowModeDefaults("review", {
    dryRun: false,
    pauseAfterPlan: true
  });
  assert.deepEqual(flags, {
    dryRun: false,
    interactive: true,
    pauseAfterPlan: true,
    pauseAfterGenerate: true
  });
});
