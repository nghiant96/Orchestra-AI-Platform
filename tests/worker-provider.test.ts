import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { runCommand } from "../ai-system/utils/api.js";
import { loadWorkerRuntimeConfig } from "../ai-system/worker/worker-config.js";
import { runWorkerRuntime } from "../ai-system/worker/worker-runtime.js";
import { CodexProvider } from "../ai-system/worker/providers/codex-provider.js";
import { buildProviderEnv } from "../ai-system/worker/provider-env.js";
import { listen, closeServer, silentLogger, requestJson } from "./test-utils.js";

describe("Worker provider execution", () => {
  test("mock CodexProvider success creates diff artifacts without mutating main checkout in dry-run", async () => {
    const repoRoot = await createGitRepo("worker-provider-success-");
    const fakeCodex = await createFakeCodex("success");
    const previousBackend = process.env.ORCHESTRA_EXECUTION_BACKEND;
    const previousWorkerToken = process.env.ORCHESTRA_WORKER_TOKEN;
    process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
    process.env.ORCHESTRA_WORKER_TOKEN = "worker-token";

    const server = createAiSystemServer({
      defaultCwd: repoRoot,
      authToken: "server-token",
      allowedWorkdirs: [repoRoot],
      logger: silentLogger(),
      runner: async () => ({ ok: true } as any)
    });

    try {
      const baseUrl = await listen(server);
      const created = await requestJson(baseUrl, "POST", "/jobs", {
        task: "Create provider output",
        cwd: repoRoot,
        dryRun: true
      }, 202, operatorHeaders());

      const summary = await runWorkerRuntime(loadWorkerRuntimeConfig({
        cwd: repoRoot,
        serverUrl: baseUrl,
        workerToken: "worker-token",
        workerName: "codex-provider-worker",
        workspaceRoots: [repoRoot],
        provider: "codex",
        providerCommand: fakeCodex,
        once: true,
        heartbeatIntervalMs: 100,
        pollIntervalMs: 100
      }), { logger: silentLogger() });

      assert.equal(summary.claimedJobs, 1);
      assert.equal(summary.completedJobs, 1);
      const job = await requestJson(baseUrl, "GET", `/jobs/${created.jobId}`, undefined, 200, { Authorization: "Bearer server-token" });
      assert.equal(job.status, "completed");
      assert.equal(job.mutationCheckpoint, undefined);
      assert.ok(job.artifactPath);
      assert.ok(Array.isArray(job.diffSummaries));
      assert.ok(Array.isArray(job.latestToolResults));
      await assert.rejects(() => fs.stat(path.join(repoRoot, "provider-output.txt")), /ENOENT/);
      const changedFiles = JSON.parse(await fs.readFile(path.join(job.artifactPath, ARTIFACT_PATHS.changedFiles), "utf8"));
      assert.deepEqual(changedFiles, ["provider-output.txt"]);
      const diff = await fs.readFile(path.join(job.artifactPath, ARTIFACT_PATHS.diffPatch), "utf8");
      assert.match(diff, /provider-output.txt/);
    } finally {
      restoreEnv(previousBackend, previousWorkerToken);
      await closeServer(server);
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(fakeCodex, { force: true });
    }
  });

  test("mock CodexProvider failure fails job with structured failure payload", async () => {
    const repoRoot = await createGitRepo("worker-provider-failure-");
    const fakeCodex = await createFakeCodex("failure");
    const previousBackend = process.env.ORCHESTRA_EXECUTION_BACKEND;
    const previousWorkerToken = process.env.ORCHESTRA_WORKER_TOKEN;
    process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
    process.env.ORCHESTRA_WORKER_TOKEN = "worker-token";

    const server = createAiSystemServer({
      defaultCwd: repoRoot,
      authToken: "server-token",
      allowedWorkdirs: [repoRoot],
      logger: silentLogger(),
      runner: async () => ({ ok: true } as any)
    });

    try {
      const baseUrl = await listen(server);
      const created = await requestJson(baseUrl, "POST", "/jobs", {
        task: "Trigger provider failure",
        cwd: repoRoot,
        dryRun: true
      }, 202, operatorHeaders());

      const summary = await runWorkerRuntime(loadWorkerRuntimeConfig({
        cwd: repoRoot,
        serverUrl: baseUrl,
        workerToken: "worker-token",
        workerName: "codex-provider-failure-worker",
        workspaceRoots: [repoRoot],
        provider: "codex",
        providerCommand: fakeCodex,
        once: true,
        heartbeatIntervalMs: 100,
        pollIntervalMs: 100
      }), { logger: silentLogger() });

      assert.equal(summary.claimedJobs, 1);
      assert.equal(summary.failedJobs, 1);
      const job = await requestJson(baseUrl, "GET", `/jobs/${created.jobId}`, undefined, 200, { Authorization: "Bearer server-token" });
      assert.equal(job.status, "failed");
      assert.equal(job.failure?.class, "provider-error");
      assert.ok(job.artifactPath);
      assert.match(await fs.readFile(path.join(job.artifactPath, ARTIFACT_PATHS.providerStderr), "utf8"), /fake codex failed/);
    } finally {
      restoreEnv(previousBackend, previousWorkerToken);
      await closeServer(server);
      await fs.rm(repoRoot, { recursive: true, force: true });
      await fs.rm(fakeCodex, { force: true });
    }
  });

  test("CodexProvider rejects worktrees outside workspace root", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worker-provider-root-"));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worker-provider-outside-"));
    const provider = new CodexProvider("codex");

    try {
      const result = await provider.execute({
        jobId: "job-test",
        task: "test",
        cwd: workspaceRoot,
        worktreePath: outsideRoot,
        workspaceRoot,
        artifactDir: path.join(workspaceRoot, ".ai-system-server", "worker-artifacts", "job-test"),
        dryRun: true,
        env: buildProviderEnv()
      });
      assert.equal(result.ok, false);
      assert.match(result.summary, /outside workspace root/);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# provider test\n", "utf8");
  await runCommand({ command: "git", args: ["add", "README.md"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}

async function createFakeCodex(mode: "success" | "failure"): Promise<string> {
  const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "fake-codex-")), "codex.js");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-codex 1.0.0");
  process.exit(0);
}
if (${JSON.stringify(mode)} === "failure") {
  console.error("fake codex failed");
  process.exit(2);
}
const cwdIndex = args.indexOf("--cwd");
const cwd = cwdIndex >= 0 ? args[cwdIndex + 1] : process.cwd();
fs.writeFileSync(path.join(cwd, "provider-output.txt"), "created by fake codex\\n");
console.log("fake codex wrote provider-output.txt");
`;
  await fs.writeFile(filePath, source, "utf8");
  await fs.chmod(filePath, 0o755);
  return filePath;
}

function operatorHeaders(): Record<string, string> {
  return {
    Authorization: "Bearer server-token",
    "x-ai-system-role": "operator",
    "x-ai-system-actor": "worker-provider-test"
  };
}

function restoreEnv(
  backend: string | undefined,
  workerToken: string | undefined
): void {
  restoreEnvValue("ORCHESTRA_EXECUTION_BACKEND", backend);
  restoreEnvValue("ORCHESTRA_WORKER_TOKEN", workerToken);
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
