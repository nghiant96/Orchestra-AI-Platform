import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { runCommand } from "../ai-system/utils/api.js";
import { buildWorkerTaskPhasePlan, loadWorkerTaskPhaseState } from "../ai-system/worker/task-phases.js";
import { executeWorkerJob } from "../ai-system/worker/job-executor.js";
import { removeTempDir } from "./test-utils.js";

describe("Worker phase planning", () => {
  test("splits a large task into multiple resumable phases", () => {
    const plan = buildWorkerTaskPhasePlan(
      "Design checkpoint/resume for worker jobs and split large Codex tasks into smaller phases before running verification."
    );

    assert.ok(plan.phases.length >= 3);
    assert.equal(plan.phases[plan.phases.length - 1]?.kind, "verification");
    assert.match(plan.phases[0]?.prompt ?? "", /phase 1\//i);
    assert.match(plan.phases[plan.phases.length - 1]?.prompt ?? "", /verification/i);
  });
});

describe("Worker phase execution", () => {
  test("writes context pack and diff boundary artifacts during provider execution", async () => {
    const repoRoot = await createGitRepo("worker-context-artifacts-");
    const fakeCodex = await createContextPackFakeCodex();
    const workspaceRoot = repoRoot;
    const jobId = "job-context-artifacts";
    const artifactDir = path.join(repoRoot, ".ai-system-server", "worker-artifacts", jobId);
    const worktreePath = path.join(repoRoot, ".orchestra", "worktrees", jobId);
    const emitted: string[] = [];
    const previousContextPackMode = process.env.ORCHESTRA_CONTEXT_PACK_MODE;

    const job = {
      jobId,
      task: "Integrate the payment API client with a focused worker implementation.",
      cwd: repoRoot,
      dryRun: false,
      workflowMode: "worker",
      workflowProfile: "balanced",
      approvalPolicy: null
    } as any;

    const worker = {
      id: "worker-context-artifacts-test",
      name: "worker-context-artifacts-test",
      version: "0.1.0",
      os: process.platform,
      arch: process.arch,
      labels: [],
      capabilities: { codex: true, node: true, pnpm: true },
      workspaceRoots: [workspaceRoot],
      status: "idle",
      lastHeartbeatAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    } as any;

    try {
      process.env.ORCHESTRA_CONTEXT_PACK_MODE = "required";
      const result = await executeWorkerJob({
        client: {} as any,
        worker,
        job,
        workspaceRoots: [workspaceRoot],
        providerId: "codex",
        providerCommand: fakeCodex,
        emitLog(message: string) {
          emitted.push(message);
        },
        async markFilesystemMutation() {}
      });

      assert.equal(result.ok, true);
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.contextPack)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.contextPackMarkdown)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.preContextPack)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.preContextPackMarkdown)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.diffBoundaryCheck)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.namingCheck)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.repoConventions)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.verification)));
      assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.manifest)));
      assert.ok(emitted.some((line) => /context pack saved/i.test(line)));

      const contextPack = JSON.parse(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.contextPack), "utf8"));
      const preContextPack = JSON.parse(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.preContextPack), "utf8"));
      const boundaryCheck = JSON.parse(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.diffBoundaryCheck), "utf8"));
      const namingCheck = JSON.parse(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.namingCheck), "utf8"));
      const manifest = JSON.parse(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.manifest), "utf8"));
      const setupPrompt = await fs.readFile(path.join(worktreePath, ".fake-codex-context-setup-prompt.txt"), "utf8");
      assert.match(setupPrompt, /Use the pre-context below/i);
      assert.match(preContextPack.summary, /No strong candidates/i);
      assert.equal(preContextPack.confidence, "low");
      assert.equal(contextPack.confidence, "high");
      assert.equal(boundaryCheck.ok, true);
      assert.equal(namingCheck.ok, true);
      assert.equal(manifest.status, "completed");
      assert.equal(manifest.mode, "team");
      assert.equal(manifest.artifacts.contextPack, ARTIFACT_PATHS.contextPack);
      assert.equal(manifest.artifacts.verification, ARTIFACT_PATHS.verification);
    } finally {
      process.env.ORCHESTRA_CONTEXT_PACK_MODE = previousContextPackMode;
      await removeTempDir(repoRoot);
      await fs.rm(fakeCodex, { force: true });
    }
  });

  test("persists phase checkpoints and resumes from the next unfinished phase", async () => {
    const repoRoot = await createGitRepo("worker-phase-runtime-");
    const fakeCodex = await createFakeCodex();
    const workspaceRoot = repoRoot;
    const jobId = "job-phase-resume";
    const artifactDir = path.join(repoRoot, ".ai-system-server", "worker-artifacts", jobId);
    const worktreePath = path.join(repoRoot, ".orchestra", "worktrees", jobId);
    const logs: string[] = [];
    const emitted: string[] = [];

    const baseJob = {
      jobId,
      task: "Split the work into checkpoints and resume points, then verify the final changes.",
      cwd: repoRoot,
      dryRun: false,
      workflowMode: "worker",
      workflowProfile: "balanced",
      approvalPolicy: null
    } as any;

    const worker = {
      id: "worker-phase-test",
      name: "worker-phase-test",
      version: "0.1.0",
      os: process.platform,
      arch: process.arch,
      labels: [],
      capabilities: { codex: true, node: true, pnpm: true },
      workspaceRoots: [workspaceRoot],
      status: "idle",
      lastHeartbeatAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    } as any;

    const ctx = {
      client: {} as any,
      worker,
      job: baseJob,
      workspaceRoots: [workspaceRoot],
      providerId: "codex",
      providerCommand: fakeCodex,
      emitLog(message: string) {
        emitted.push(message);
      },
      async markFilesystemMutation() {
        logs.push("checkpoint");
      }
    };

    try {
      const firstRun = await executeWorkerJob(ctx);
      assert.equal(firstRun.ok, false);
      assert.match(firstRun.summary, /failed|timeout/i);

      const phaseStateAfterFailure = await loadWorkerTaskPhaseState(artifactDir);
      assert.ok(phaseStateAfterFailure);
      assert.equal(phaseStateAfterFailure?.phases.filter((phase) => phase.status === "completed").length, 1);
      assert.ok(phaseStateAfterFailure?.phases.some((phase) => phase.status === "failed"));

      const secondRun = await executeWorkerJob(ctx);
      assert.equal(secondRun.ok, true);
      assert.ok(secondRun.filesystemMutated);

      const phaseStateAfterResume = await loadWorkerTaskPhaseState(artifactDir);
      assert.ok(phaseStateAfterResume);
      assert.equal(phaseStateAfterResume?.phases.every((phase) => phase.status === "completed"), true);
      assert.ok(emitted.some((line) => /resuming from phase/i.test(line)));
      assert.ok(await exists(path.join(worktreePath, "phase-1.txt")));
      assert.ok(await exists(path.join(worktreePath, "phase-2.txt")) || await exists(path.join(worktreePath, "phase-3.txt")));
    } finally {
      await removeTempDir(repoRoot);
      await fs.rm(fakeCodex, { force: true });
    }
  });
});

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# phase test\n", "utf8");
  await runCommand({ command: "git", args: ["add", "README.md"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}

async function createContextPackFakeCodex(): Promise<string> {
  const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "fake-codex-context-")), "codex.js");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-codex 1.0.0");
  process.exit(0);
}
const prompt = args[1] || "";
const cwd = process.cwd();
const statePath = path.join(cwd, ".fake-codex-context-state.json");
let state = { count: 0 };
try {
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
} catch {}
state.count += 1;
fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
if (prompt.includes("Phase kind: setup")) {
  fs.writeFileSync(path.join(cwd, ".fake-codex-context-setup-prompt.txt"), prompt, "utf8");
  console.log('ORCHESTRA_CONTEXT_PACK:');
  console.log(JSON.stringify({
    summary: "Payment API worker context",
    relevantFiles: [
      { path: "src/payment/api.ts", reason: "Payment API client target", status: "proposed", role: "api-client" }
    ],
    allowedDiffBoundary: ["src/payment/**"],
    doNotTouch: ["src/auth/**"],
    conventions: { apiClientPatterns: ["*Api.ts"] },
    implementationPlan: ["Create payment API client"],
    verificationCommands: [],
    assumptions: [],
    missingContextWarnings: [],
    confidence: "high"
  }, null, 2));
  process.exit(0);
}
if (prompt.includes("Phase kind: implementation")) {
  const target = path.join(cwd, "src", "payment", "api.ts");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "export const paymentApi = () => 'ok';\\n", "utf8");
  console.log("implemented payment api");
  process.exit(0);
}
console.log("verification phase complete");
`;
  await fs.writeFile(filePath, source, "utf8");
  await fs.chmod(filePath, 0o755);
  return filePath;
}

async function createFakeCodex(): Promise<string> {
  const filePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "fake-codex-phase-")), "codex.js");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-codex 1.0.0");
  process.exit(0);
}
const cwd = process.cwd();
const statePath = path.join(cwd, ".fake-codex-state.json");
let state = { count: 0, failedOnce: false };
try {
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
} catch {}
state.count += 1;
if (state.count === 2 && !state.failedOnce) {
  state.failedOnce = true;
  fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
  console.error("fake codex timed out");
  process.exit(2);
}
const outputPath = path.join(cwd, 'phase-' + state.count + '.txt');
fs.writeFileSync(outputPath, 'phase ' + state.count + '\\n', "utf8");
fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
console.log('fake codex wrote ' + path.basename(outputPath));
`;
  await fs.writeFile(filePath, source, "utf8");
  await fs.chmod(filePath, 0o755);
  return filePath;
}

async function exists(value: string): Promise<boolean> {
  try {
    await fs.stat(value);
    return true;
  } catch {
    return false;
  }
}
