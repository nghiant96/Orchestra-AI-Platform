import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { assessWorkItem } from "../ai-system/work/assessment.js";
import { buildChecklist } from "../ai-system/work/checklist.js";
import { buildTaskGraph } from "../ai-system/work/task-graph.js";
import type { RulesConfig } from "../ai-system/types.js";
import { listen, waitForHttpReady, closeServer, silentLogger, requestJson } from "./test-utils.js";

test("workspace assessment, graph, and checklist are generated deterministically", async () => {
  const rules = { artifacts: { data_dir: ".artifacts" } } as RulesConfig;
  const workItem = {
    title: "Fix login redirect",
    description: "Adjust auth callback behavior",
    projectId: "demo",
    type: "bugfix" as const,
    source: "manual" as const,
    expectedOutput: "patch" as const,
    risk: "low" as const
  };

  const assessment = assessWorkItem(workItem, rules);
  const graph = buildTaskGraph(workItem);
  const checklist = buildChecklist(workItem, graph);

  assert.ok(["low", "medium", "high", "blocked"].includes(assessment.risk));
  assert.ok(assessment.modelTier !== undefined);
  assert.ok(Array.isArray(assessment.affectedAreas));
  assert.ok(graph.nodes.length >= 3);
  assert.ok(checklist.length >= graph.nodes.length);
});

test("workspace API can create assess run and list work items", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-workspace-api-"));
  await fs.writeFile(path.join(repoRoot, ".ai-system.json"), JSON.stringify({ skip_approval: true }), "utf8");
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async ({ task, cwd, dryRun }) => createResult(task, cwd, dryRun)
  });

  try {
    const baseUrl = await listen(server);
    await waitForHttpReady(baseUrl);
    const created = await requestJson(baseUrl, "POST", "/work-items", { cwd: repoRoot, title: "Fix signup flow", description: "Adjust auth callback" }, 201);
    assert.equal(created.ok, true);
    assert.equal(created.workItem.status, "created");

    const assessed = await requestJson(baseUrl, "POST", `/work-items/${created.workItem.id}/assess`, { cwd: repoRoot }, 200);
    assert.equal(assessed.ok, true);
    assert.ok(assessed.workItem.assessment);
    assert.ok(assessed.workItem.graph?.nodes.length);

    const run = await requestJson(baseUrl, "POST", `/work-items/${created.workItem.id}/run`, { cwd: repoRoot, dryRun: true }, 202);
    assert.equal(run.ok, true);
    assert.equal(run.workItem.status, "executing");
    assert.equal(run.workItem.linkedRuns.length, 1);
    assert.equal(run.workItem.graph.nodes.find((node: any) => node.id === "inspect-1").assignedRunId, run.job.jobId);
    assert.match(run.job.task, /Graph node: inspect-1 \(inspect\)/);

    await waitForJob(baseUrl, String(run.job.jobId), "completed");
    const loaded = await requestJson(baseUrl, "GET", `/work-items/${created.workItem.id}?cwd=${encodeURIComponent(repoRoot)}`);
    assert.equal(loaded.workItem.graph.nodes.find((node: any) => node.id === "inspect-1").status, "completed");
    assert.equal(loaded.workItem.checklist.find((item: any) => item.id === "inspect-1").status, "passed");

    const list = await requestJson(baseUrl, "GET", `/work-items?cwd=${encodeURIComponent(repoRoot)}`);
    assert.equal(list.ok, true);
    assert.ok(list.workItems.some((item: any) => item.id === created.workItem.id));
  } finally {
    await closeServer(server);
    await cleanupDir(repoRoot);
  }
});

function createResult(task: string, cwd: string, dryRun: boolean) {
  return {
    version: 1,
    ok: true,
    status: "completed" as const,
    dryRun,
    repoRoot: cwd,
    configPath: null,
    plan: { prompt: task, readFiles: [], writeTargets: [], notes: [] },
    result: { summary: "ok", files: [] },
    iterations: [],
    issueCounts: {},
    skippedContextFiles: [],
    finalIssues: [],
    providers: { planner: "test", reviewer: "test", generator: "test", fixer: "test" },
    memory: { backend: "test", planningMatches: 0, implementationMatches: 0, stored: false },
    artifacts: {
      enabled: true,
      ok: true,
      runPath: path.join(cwd, ".ai-system-artifacts", "mock-run"),
      latestIterationPath: null,
      stepPaths: {},
      latestFiles: []
    },
    wroteFiles: false
  };
}

async function waitForJob(baseUrl: string, jobId: string, status: string): Promise<any> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const job = await requestJson(baseUrl, "GET", `/jobs/${jobId}`);
      if (job.status === status) return job;
    } catch (error) {
      const message = (error as Error).message;
      if (!message.includes("HTTP 404")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
}

async function cleanupDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY" || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
