import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { runCommand } from "../ai-system/utils/api.js";

const workspaceRoot = process.cwd();
const tsxLoaderPath = path.join(workspaceRoot, "node_modules", "tsx", "dist", "esm", "index.mjs");

test("CLI quick runs a Solo Mode job without server", async () => {
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
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
    await fs.rm(path.dirname(fakeCodex), { recursive: true, force: true });
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
