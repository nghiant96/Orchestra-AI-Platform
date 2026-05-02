import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { WorkStore } from "../ai-system/work/work-store.js";
import type { RulesConfig } from "../ai-system/types.js";

describe("WorkItem Store", () => {
  let tmpDir: string;
  let repoRoot: string;
  let store: WorkStore;
  const rules: RulesConfig = {
    artifacts: {
      data_dir: ".test-artifacts"
    }
  } as any;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-item-test-"));
    repoRoot = tmpDir;
    store = new WorkStore(repoRoot, rules);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("creates and saves a work item", async () => {
    const item = await store.create({
      title: "Fix login bug",
      projectId: "p1",
      description: "Intermittent redirect issues"
    });

    assert.ok(item.id.startsWith("work-"), "Should have work- prefix");
    assert.strictEqual(item.title, "Fix login bug");
    assert.strictEqual(item.status, "created");

    const loaded = await store.load(item.id);
    assert.ok(loaded, "Should load saved item");
    assert.strictEqual(loaded.id, item.id);
    assert.strictEqual(loaded.description, "Intermittent redirect issues");
  });

  test("creates the required W1 sidecar artifact files", async () => {
    const item = await store.create({
      title: "Add workspace sidecars",
      projectId: "p1",
      linkedRuns: ["run_123"],
      checklist: [
        {
          id: "check-1",
          text: "Smoke test passed",
          required: true,
          status: "passed",
          evidence: { type: "check", ref: "pnpm test" }
        }
      ]
    });
    const workDir = path.join(repoRoot, ".test-artifacts", "work-items", item.id);

    const workItemRecord = JSON.parse(await fs.readFile(path.join(workDir, "work-item.json"), "utf8"));
    const assessmentRecord = JSON.parse(await fs.readFile(path.join(workDir, "assessment.json"), "utf8"));
    const graphRecord = JSON.parse(await fs.readFile(path.join(workDir, "task-graph.json"), "utf8"));
    const checklistRecord = JSON.parse(await fs.readFile(path.join(workDir, "checklist.json"), "utf8"));
    const runsRecord = JSON.parse(await fs.readFile(path.join(workDir, "runs.json"), "utf8"));

    assert.strictEqual(workItemRecord.id, item.id);
    assert.strictEqual(workItemRecord.linkedRuns, undefined, "linked runs must live in runs.json");
    assert.strictEqual(workItemRecord.checklist, undefined, "checklist must live in checklist.json");
    assert.deepStrictEqual(assessmentRecord, { schemaVersion: 1, workItemId: item.id, assessment: null });
    assert.deepStrictEqual(graphRecord, { schemaVersion: 1, workItemId: item.id, graph: { nodes: [], edges: [] } });
    assert.strictEqual(checklistRecord.schemaVersion, 1);
    assert.strictEqual(checklistRecord.workItemId, item.id);
    assert.strictEqual(checklistRecord.items.length, 1);
    assert.deepStrictEqual(runsRecord, { schemaVersion: 1, workItemId: item.id, linkedRuns: ["run_123"] });

    const loaded = await store.load(item.id);
    assert.ok(loaded);
    assert.deepStrictEqual(loaded.linkedRuns, ["run_123"]);
    assert.strictEqual(loaded.checklist?.length, 1);
    assert.deepStrictEqual(loaded.graph, { nodes: [], edges: [] });
  });

  test("lists saved work items", async () => {
    await store.create({ title: "Task 1", projectId: "p1" });
    await store.create({ title: "Task 2", projectId: "p1" });

    const list = await store.list();
    assert.ok(list.length >= 2, "Should list at least 2 items");
    assert.ok(list.some(i => i.title === "Task 1"));
    assert.ok(list.some(i => i.title === "Task 2"));
  });

  test("normalizes missing fields", async () => {
    // Manually create an incomplete JSON file
    const workDir = path.join(repoRoot, ".test-artifacts", "work-items", "work-incomplete");
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(
      path.join(workDir, "work-item.json"),
      JSON.stringify({ id: "work-incomplete", title: "Incomplete" }),
      "utf8"
    );

    const loaded = await store.load("work-incomplete");
    assert.ok(loaded);
    assert.strictEqual(loaded.status, "created", "Should default status");
    assert.strictEqual(loaded.projectId, "", "Should default projectId");
    assert.deepStrictEqual(loaded.linkedRuns, [], "Should default linkedRuns");
  });

  test("rejects unsafe work item ids", async () => {
    await assert.rejects(
      () => store.create({ id: "../escape", title: "Escape", projectId: "p1" }),
      /Invalid work item id/
    );
    await assert.rejects(
      () => store.load("../escape"),
      /Invalid work item id/
    );
    await assert.rejects(
      () => store.load("work-../../escape"),
      /Invalid work item id/
    );
  });

  test("returns null for non-existent item", async () => {
    const loaded = await store.load("work-missing");
    assert.strictEqual(loaded, null);
  });
});
