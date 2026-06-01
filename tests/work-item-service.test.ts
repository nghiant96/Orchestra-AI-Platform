import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileBackedJobQueue } from "../ai-system/core/job-queue.js";
import { FileAuditLog } from "../ai-system/core/audit-log.js";
import { resolveJobQueueDirectory } from "../ai-system/core/job-queue.js";
import { resolveAuditLogPath } from "../ai-system/core/audit-log.js";
import {
  listWorkItems,
  createWorkItem,
  getWorkItem,
  runWorkItem,
  normalizeWorkItemInput,
  normalizeWorkItemType,
  normalizeWorkItemSource,
  normalizeExpectedOutput
} from "../ai-system/work/work-item-service.js";

describe("WorkItemService", () => {
  let tmpDir: string;
  let queue: FileBackedJobQueue;
  let auditLog: FileAuditLog;

  test.before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-item-service-test-"));
    queue = new FileBackedJobQueue(resolveJobQueueDirectory(tmpDir), async () => ({} as any));
    auditLog = new FileAuditLog(resolveAuditLogPath(tmpDir));
  });

  test.after(async () => {
    await queue.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const ctx = () => ({
    queue,
    auditLog,
    actor: { id: "test-user", role: "operator" as const },
    rules: { artifacts: { data_dir: ".test-artifacts" } } as any
  });

  test("createWorkItem creates a work item", async () => {
    const result = await createWorkItem(ctx(), tmpDir, {
      title: "Fix login bug",
      description: "Fix the login redirect"
    });
    assert.equal(result.ok, true);
    assert.equal(result.workItem.title, "Fix login bug");
    assert.equal(result.workItem.description, "Fix the login redirect");
    assert.equal(result.workItem.status, "created");
    assert.ok(result.workItem.id.startsWith("work-"));
  });

  test("createWorkItem rejects empty title", async () => {
    const result = await createWorkItem(ctx(), tmpDir, { title: "" });
    assert.equal(result.ok, true);
    assert.equal(result.workItem.title, "Untitled Work Item");
  });

  test("getWorkItem retrieves a work item", async () => {
    const created = await createWorkItem(ctx(), tmpDir, { title: "Get test" });
    const result = await getWorkItem(ctx(), tmpDir, created.workItem.id);
    assert.equal(result.ok, true);
    assert.equal(result.workItem?.id, created.workItem.id);
  });

  test("getWorkItem returns error for unknown id", async () => {
    const result = await getWorkItem(ctx(), tmpDir, "work-nonexistent");
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  test("runWorkItem returns 404 for missing work item", async () => {
    const result = await runWorkItem(ctx(), tmpDir, "work-missing");
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 404);
    assert.equal(result.error, "Work item not found");
  });

  test("listWorkItems returns work items", async () => {
    const created = await createWorkItem(ctx(), tmpDir, { title: "List test" });
    const result = await listWorkItems(ctx(), tmpDir);
    assert.equal(result.ok, true);
    assert.equal(result.version, 1);
    assert.ok(result.workItems.some((wi) => wi.id === created.workItem.id));
  });

  test("normalizeWorkItemInput parses old payload", () => {
    const input = normalizeWorkItemInput({
      title: "Fix bug",
      description: "Fix it",
      type: "bugfix",
      source: "github_issue",
      expectedOutput: "patch",
      linkedRuns: ["run-1", "run-2"]
    });
    assert.equal(input.title, "Fix bug");
    assert.equal(input.description, "Fix it");
    assert.equal(input.type, "bugfix");
    assert.equal(input.source, "github_issue");
    assert.equal(input.expectedOutput, "patch");
    assert.deepEqual(input.linkedRuns, ["run-1", "run-2"]);
  });

  test("normalizeWorkItemInput parses new Hermes fields", () => {
    const input = normalizeWorkItemInput({
      title: "Refactor auth",
      stage: "planning",
      executionMode: "worker",
      workflowProfile: "superpowers",
      routingProfile: "balanced",
      requestedBy: "hermes-agent",
      repo: { localPath: "/tmp/repo", remote: "https://github.com/org/repo" }
    });
    assert.equal(input.stage, "planning");
    assert.equal(input.executionMode, "worker");
    assert.equal(input.workflowProfile, "superpowers");
    assert.equal(input.routingProfile, "balanced");
    assert.equal(input.requestedBy, "hermes-agent");
    assert.deepEqual(input.repo, { localPath: "/tmp/repo", remote: "https://github.com/org/repo" });
  });

  test("normalizeWorkItemInput handles missing optional fields", () => {
    const input = normalizeWorkItemInput({ title: "Simple" });
    assert.equal(input.stage, undefined);
    assert.equal(input.executionMode, undefined);
    assert.equal(input.workflowProfile, undefined);
    assert.equal(input.repo, undefined);
  });

  test("normalizeWorkItemType returns valid types", () => {
    assert.equal(normalizeWorkItemType("bugfix"), "bugfix");
    assert.equal(normalizeWorkItemType("feature"), "feature");
    assert.equal(normalizeWorkItemType("invalid"), "feature");
    assert.equal(normalizeWorkItemType(undefined), "feature");
  });

  test("normalizeWorkItemSource returns valid sources", () => {
    assert.equal(normalizeWorkItemSource("manual"), "manual");
    assert.equal(normalizeWorkItemSource("github_issue"), "github_issue");
    assert.equal(normalizeWorkItemSource("invalid"), "manual");
  });

  test("normalizeExpectedOutput returns valid outputs", () => {
    assert.equal(normalizeExpectedOutput("patch"), "patch");
    assert.equal(normalizeExpectedOutput("pull_request"), "pull_request");
    assert.equal(normalizeExpectedOutput("invalid"), "patch");
  });
});
