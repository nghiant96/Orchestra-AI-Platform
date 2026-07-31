import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { runCommand } from "../ai-system/utils/api.js";
import { removeTempDir } from "./test-utils.js";

const workspaceRoot = process.cwd();
const tsxLoaderPath = path.join(workspaceRoot, "node_modules", "tsx", "dist", "esm", "index.mjs");

test("CLI quick job history, diff explain, and undo run without server", async () => {
  const repoRoot = await createGitRepo("solo-cli-");
  const fakeCodex = await createFakeCodex();

  try {
    const result = await runCli(["quick", "Create solo CLI output"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ORCHESTRA_CODEX_COMMAND: fakeCodex,
        PATH: process.env.PATH ?? ""
      }
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Solo Job/);
    assert.match(result.stdout, /artifacts:/);

    const jobsDir = path.join(repoRoot, ".orchestra", "jobs");
    const jobs = await fs.readdir(jobsDir);
    assert.equal(jobs.length, 1);
    const artifactRoot = path.join(jobsDir, jobs[0] ?? "");
    const manifest = JSON.parse(await fs.readFile(path.join(artifactRoot, ARTIFACT_PATHS.manifest), "utf8"));
    assert.equal(manifest.mode, "solo");
    assert.equal(manifest.executionMode, "quick");
    assert.equal(manifest.status, "completed");
    await fs.access(path.join(artifactRoot, ARTIFACT_PATHS.diffPatch));

    const list = await runCli(["job", "list"], {
      cwd: repoRoot,
      env: process.env
    });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /Solo Jobs/);
    assert.match(list.stdout, new RegExp(jobs[0] ?? "missing-job-id"));

    const show = await runCli(["job", "show", "last"], {
      cwd: repoRoot,
      env: process.env
    });
    assert.equal(show.code, 0, show.stderr);
    assert.match(show.stdout, /solo-cli-output\.ts/);

    const logs = await runCli(["job", "logs", "last"], {
      cwd: repoRoot,
      env: process.env
    });
    assert.equal(logs.code, 0, logs.stderr);
    assert.match(logs.stdout, /ORCHESTRA_CONTEXT_PACK/);

    const explain = await runCli(["diff", "explain"], {
      cwd: repoRoot,
      env: process.env
    });
    assert.equal(explain.code, 0, explain.stderr);
    assert.match(explain.stdout, /1 file changed/);
    assert.match(explain.stdout, /solo-cli-output\.ts/);

    const undo = await runCli(["undo", "last"], {
      cwd: repoRoot,
      env: process.env
    });
    assert.equal(undo.code, 0, undo.stderr);
    assert.match(undo.stdout, /Solo Undo/);
    await assert.rejects(() => fs.stat(path.join(repoRoot, "src", "solo-cli-output.ts")), /ENOENT/);
  } finally {
    await removeTempDir(repoRoot);
    await removeTempDir(path.dirname(fakeCodex));
  }
});

test("CLI quick job can opt into a dirty working tree", async () => {
  const repoRoot = await createGitRepo("solo-cli-dirty-");
  const fakeCodex = await createFakeCodex();
  const env = {
    ...process.env,
    ORCHESTRA_CODEX_COMMAND: fakeCodex,
    PATH: process.env.PATH ?? ""
  };

  try {
    await fs.writeFile(path.join(repoRoot, "README.md"), "# dirty solo cli test\n", "utf8");

    const result = await runCli(["quick", "--allow-dirty", "Create solo CLI output"], {
      cwd: repoRoot,
      env
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Solo Job/);
    assert.match(result.stdout, /success: true/);
    await fs.access(path.join(repoRoot, "src", "solo-cli-output.ts"));
  } finally {
    await removeTempDir(repoRoot);
    await removeTempDir(path.dirname(fakeCodex));
  }
});

test("CLI quick job can stash and restore dirty changes", async () => {
  const repoRoot = await createGitRepo("solo-cli-stash-");
  const fakeCodex = await createFakeCodex();
  const env = {
    ...process.env,
    ORCHESTRA_CODEX_COMMAND: fakeCodex,
    PATH: process.env.PATH ?? ""
  };

  try {
    await fs.writeFile(path.join(repoRoot, "README.md"), "# stashed dirty solo cli test\n", "utf8");

    const result = await runCli(["quick", "--stash", "Create solo CLI output"], {
      cwd: repoRoot,
      env
    });

    assert.equal(result.code, 0, result.stderr);
    const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
    assert.match(readme, /stashed dirty solo cli test/);
    assert.match(result.stdout, /Solo Job/);
  } finally {
    await removeTempDir(repoRoot);
    await removeTempDir(path.dirname(fakeCodex));
  }
});

test("CLI quick job can run in a dedicated worktree", async () => {
  const repoRoot = await createGitRepo("solo-cli-worktree-");
  const fakeCodex = await createFakeCodex();
  const env = {
    ...process.env,
    ORCHESTRA_CODEX_COMMAND: fakeCodex,
    PATH: process.env.PATH ?? ""
  };

  try {
    await fs.writeFile(path.join(repoRoot, "README.md"), "# worktree dirty solo cli test\n", "utf8");

    const result = await runCli(["quick", "--worktree", "Create solo CLI output"], {
      cwd: repoRoot,
      env
    });

    assert.equal(result.code, 0, result.stderr);
    const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
    assert.match(readme, /worktree dirty solo cli test/);

    const worktreeRoot = path.join(repoRoot, ".orchestra", "worktrees");
    const entries = await fs.readdir(worktreeRoot);
    assert.equal(entries.length > 0, true);
    const worktreePath = path.join(worktreeRoot, entries[0] ?? "");
    await fs.access(path.join(worktreePath, "src", "solo-cli-output.ts"));
  } finally {
    await removeTempDir(repoRoot);
    await removeTempDir(path.dirname(fakeCodex));
  }
});

test("CLI continue and commit run without server", async () => {
  const repoRoot = await createGitRepo("solo-cli-continue-");
  const fakeCodex = await createFakeCodex();
  const env = {
    ...process.env,
    ORCHESTRA_CODEX_COMMAND: fakeCodex,
    PATH: process.env.PATH ?? ""
  };

  try {
    const first = await runCli(["quick", "Create solo CLI output"], { cwd: repoRoot, env });
    assert.equal(first.code, 0, first.stderr);

    const continued = await runCli(["continue", "--fix-verification"], { cwd: repoRoot, env });
    assert.equal(continued.code, 0, continued.stderr);
    assert.match(continued.stdout, /Solo Continue/);

    const jobs = await fs.readdir(path.join(repoRoot, ".orchestra", "jobs"));
    assert.equal(jobs.length, 2);

    const committed = await runCli(["commit", "last"], { cwd: repoRoot, env });
    assert.equal(committed.code, 0, committed.stderr);
    assert.match(committed.stdout, /Solo Commit/);
    assert.match(committed.stdout, /commit:/);
    assert.match(committed.stdout, /Apply solo job/);

    const sourceStatus = await runCommand({
      command: "git",
      args: ["status", "--porcelain", "--", "src/solo-cli-output.ts"],
      cwd: repoRoot
    });
    assert.equal(sourceStatus.stdout.trim(), "");
  } finally {
    await removeTempDir(repoRoot);
    await removeTempDir(path.dirname(fakeCodex));
  }
});

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# solo cli test\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify({
    name: "solo-cli-test",
    private: true,
    type: "module"
  }, null, 2), "utf8");
  await runCommand({ command: "git", args: ["add", "."], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}

async function createFakeCodex(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fake-solo-codex-"));
  const filePath = path.join(dir, "codex.js");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-codex 1.0.0");
  process.exit(0);
}
fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "src", "solo-cli-output.ts"), "export const soloCliOutput = true;\\n");
console.log("ORCHESTRA_CONTEXT_PACK:");
console.log(JSON.stringify({
  summary: "Solo CLI context",
  relevantFiles: [{
    path: "src/solo-cli-output.ts",
    reason: "Requested output",
    status: "proposed",
    role: "unknown"
  }],
  allowedDiffBoundary: ["src/**"],
  doNotTouch: [],
  conventions: {},
  implementationPlan: ["Create the CLI output file"],
  verificationCommands: [],
  assumptions: [],
  missingContextWarnings: [],
  confidence: "high"
}));
`;
  await fs.writeFile(filePath, source, "utf8");
  await fs.chmod(filePath, 0o755);
  return filePath;
}

function runCli(args: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      tsxLoaderPath,
      path.join(workspaceRoot, "ai-system", "cli.ts"),
      ...args
    ], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
