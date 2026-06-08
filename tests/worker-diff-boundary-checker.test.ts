import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  runDiffBoundaryCheck,
  writeDiffBoundaryCheckArtifact
} from "../ai-system/worker/diff-boundary-checker.js";
import { runCommand } from "../ai-system/utils/api.js";
import type { WorkerContextPack } from "../ai-system/worker/context-pack.js";

test("diff boundary checker warns for outside boundary changes by default", async () => {
  const repoRoot = await createGitRepo("diff-boundary-warn-");
  try {
    await fs.mkdir(path.join(repoRoot, "src/auth"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "src/auth/session.ts"), "export const session = 1;\n", "utf8");

    const result = await withEnv({}, () => runDiffBoundaryCheck({
      changedFiles: ["src/auth/session.ts"],
      contextPack: contextPack({
        allowedDiffBoundary: ["src/payment/**"],
        doNotTouch: []
      }),
      repoRoot,
      worktreePath: repoRoot
    }));

    assert.equal(result.ok, true);
    assert.equal(result.mode, "warn");
    assert.equal(result.findings[0]?.code, "BOUNDARY_OUTSIDE_ALLOWED");
    assert.equal(result.findings[0]?.severity, "warning");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("diff boundary checker fails for doNotTouch matches", async () => {
  const repoRoot = await createGitRepo("diff-boundary-dnt-");
  try {
    const result = await withEnv({}, () => runDiffBoundaryCheck({
      changedFiles: ["src/auth/session.ts"],
      contextPack: contextPack({
        allowedDiffBoundary: ["src/**"],
        doNotTouch: ["src/auth/**"]
      }),
      repoRoot,
      worktreePath: repoRoot
    }));

    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.code, "TOUCHED_DO_NOT_TOUCH");
    assert.equal(result.findings[0]?.severity, "error");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("diff boundary checker detects undeclared new files and writes artifact", async () => {
  const repoRoot = await createGitRepo("diff-boundary-new-");
  const artifactDir = path.join(repoRoot, "artifact");
  try {
    await fs.mkdir(path.join(repoRoot, "src/payment"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "src/payment/new-helper.ts"), "export const helper = 1;\n", "utf8");

    const result = await withEnv({ ORCHESTRA_NEW_FILE_POLICY: "strict" }, () => runDiffBoundaryCheck({
      changedFiles: ["src/payment/new-helper.ts"],
      contextPack: contextPack({
        allowedDiffBoundary: ["src/payment/**"],
        doNotTouch: []
      }),
      repoRoot,
      worktreePath: repoRoot
    }));
    await writeDiffBoundaryCheckArtifact(artifactDir, result);

    assert.equal(result.ok, false);
    assert.equal(result.findings.some((finding) => finding.code === "NEW_FILE_NOT_DECLARED"), true);

    const artifact = JSON.parse(await fs.readFile(path.join(artifactDir, "diff-boundary-check.json"), "utf8"));
    assert.equal(artifact.version, 1);
    assert.equal(artifact.ok, false);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# test\n", "utf8");
  await runCommand({ command: "git", args: ["add", "README.md"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}

function contextPack(input: {
  allowedDiffBoundary: string[];
  doNotTouch: string[];
}): WorkerContextPack {
  return {
    version: 1,
    jobId: "job",
    task: "task",
    generatedAt: "2026-06-06T00:00:00.000Z",
    summary: "summary",
    relevantFiles: [],
    allowedDiffBoundary: input.allowedDiffBoundary,
    doNotTouch: input.doNotTouch,
    conventions: {},
    implementationPlan: [],
    verificationCommands: [],
    assumptions: [],
    missingContextWarnings: [],
    confidence: "medium"
  };
}

async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = {
    ORCHESTRA_DIFF_BOUNDARY_MODE: process.env.ORCHESTRA_DIFF_BOUNDARY_MODE,
    ORCHESTRA_NEW_FILE_POLICY: process.env.ORCHESTRA_NEW_FILE_POLICY
  };
  for (const key of Object.keys(previous)) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
