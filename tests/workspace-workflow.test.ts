import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { assessWorkItem } from "../ai-system/work/assessment.js";
import { buildChecklist } from "../ai-system/work/checklist.js";
import { buildTaskGraph } from "../ai-system/work/task-graph.js";
import type { Logger, RulesConfig } from "../ai-system/types.js";

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
    const created = await requestJson(baseUrl, "POST", "/work-items", { cwd: repoRoot, title: "Fix signup flow", description: "Adjust auth callback" });
    assert.equal(created.ok, true);
    assert.equal(created.workItem.status, "created");

    const assessed = await requestJson(baseUrl, "POST", `/work-items/${created.workItem.id}/assess`, { cwd: repoRoot });
    assert.equal(assessed.ok, true);
    assert.ok(assessed.workItem.assessment);
    assert.ok(assessed.workItem.graph?.nodes.length);

    const run = await requestJson(baseUrl, "POST", `/work-items/${created.workItem.id}/run`, { cwd: repoRoot, dryRun: true });
    assert.equal(run.ok, true);
    assert.equal(run.workItem.status, "executing");
    assert.equal(run.workItem.linkedRuns.length, 1);

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

function requestJson(baseUrl: string, method: string, pathname: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(url, { method, headers: { "content-type": "application/json", accept: "application/json" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function listen(server: ReturnType<typeof createAiSystemServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      if (!addr) return reject(new Error("No address"));
      resolve(`http://127.0.0.1:${addr.port}`);
    });
    server.on("error", reject);
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function silentLogger(): Logger {
  return { step() {}, info() {}, warn() {}, error() {}, success() {} };
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
