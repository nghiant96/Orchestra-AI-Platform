import test from "node:test";
import assert from "node:assert/strict";
import { WorkEngine } from "../ai-system/work/work-engine.js";
import type { QueueJob } from "../ai-system/core/job-queue.js";
import type { RulesConfig } from "../ai-system/types.js";
import type { WorkItem } from "../ai-system/work/work-item.js";

test("WorkEngine maps the next executable graph node to an orchestrator request", async () => {
  const workItem = createWorkItem();
  const engine = new WorkEngine({} as RulesConfig);

  const { workItem: planned, requests } = await engine.createNodeExecutionRequests(workItem, { dryRun: true });

  assert.equal(planned.status, "planning");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.nodeId, "inspect-1");
  assert.equal(requests[0]?.workflowMode, "review");
  assert.match(requests[0]?.task ?? "", /Graph node: inspect-1 \(inspect\)/);
  assert.match(requests[0]?.task ?? "", /Execute only this graph node/);
});

test("WorkEngine links queued runs and reconciles node and checklist status", async () => {
  const engine = new WorkEngine({} as RulesConfig);
  const { workItem: planned, requests } = await engine.createNodeExecutionRequests(createWorkItem(), { dryRun: true });

  const running = engine.attachQueuedRuns(planned, [{ nodeId: requests[0]!.nodeId, runId: "job-1" }]);
  assert.equal(running.status, "executing");
  assert.deepEqual(running.linkedRuns, ["job-1"]);
  assert.equal(running.graph?.nodes.find((node) => node.id === "inspect-1")?.status, "running");
  assert.equal(running.checklist?.find((item) => item.id === "inspect-1")?.status, "doing");

  const reconciled = engine.reconcileRunResults(running, [createQueueJob("job-1", "completed")]);
  assert.equal(reconciled.graph?.nodes.find((node) => node.id === "inspect-1")?.status, "completed");
  const checklistItem = reconciled.checklist?.find((item) => item.id === "inspect-1");
  assert.equal(checklistItem?.status, "passed");
  assert.deepEqual(checklistItem?.evidence, { type: "run", ref: "job-1" });

  const next = await engine.createNodeExecutionRequests(reconciled, { dryRun: false });
  assert.equal(next.requests[0]?.nodeId, "test-2");
});

function createWorkItem(): WorkItem {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: "work-2026-05-02-fix-login",
    projectId: "demo",
    title: "Fix login redirect",
    description: "Adjust auth callback behavior",
    source: "manual",
    type: "bugfix",
    status: "created",
    risk: "low",
    expectedOutput: "patch",
    createdBy: "test",
    createdAt: now,
    updatedAt: now,
    linkedRuns: []
  };
}

function createQueueJob(jobId: string, status: QueueJob["status"]): QueueJob {
  const now = new Date().toISOString();
  return {
    version: 1,
    jobId,
    status,
    task: "run node",
    cwd: "/tmp/repo",
    dryRun: true,
    createdAt: now,
    updatedAt: now,
    artifactPath: "/tmp/repo/.ai-system-artifacts/run",
    resultSummary: "ok",
    error: null
  };
}
