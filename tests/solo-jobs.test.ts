import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { runSoloJob } from "../ai-system/solo/solo-runner.js";
import {
  buildSoloCommitMessage,
  continueSoloJob,
  commitSoloJob,
  explainSoloDiff,
  listSoloJobs,
  readSoloJobLogs,
  showSoloJob,
  undoSoloJob
} from "../ai-system/solo/solo-jobs.js";
import { runCommand } from "../ai-system/utils/api.js";
import type { WorkerProviderAdapter } from "../ai-system/worker/providers/provider-adapter.js";
import type { AuditLogRepository } from "../ai-system/core/audit-log.js";

test("Solo job operations list, show, read logs, explain diff, and undo", async () => {
  const repoRoot = await createGitRepo("solo-jobs-");
  const artifactRootDir = path.join(repoRoot, ".orchestra", "jobs");

  try {
    const run = await runSoloJob({
      task: "Create solo history output.",
      executionMode: "normal",
      repoRoot,
      providerId: "codex",
      artifactRootDir
    }, {
      provider: fakeProvider("src/history-output.ts"),
      createJobId: () => "job-history-test"
    });

    const jobs = await listSoloJobs({ repoRoot, artifactRootDir });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.jobId, "job-history-test");
    assert.equal(jobs[0]?.changedFileCount, 1);

    const shown = await showSoloJob({ repoRoot, artifactRootDir, target: "last" });
    assert.equal(shown.manifest.jobId, "job-history-test");
    assert.deepEqual(shown.changedFiles, ["src/history-output.ts"]);
    assert.match(shown.diffStat, /history-output/);
    assert.equal(shown.verification?.status, "passed");

    const logs = await readSoloJobLogs({ repoRoot, artifactRootDir, target: run.jobId });
    assert.match(logs.stdout, /ORCHESTRA_CONTEXT_PACK/);
    assert.equal(logs.stderr, "");

    const diff = await explainSoloDiff({ repoRoot, artifactRootDir, target: "last" });
    assert.equal(diff.changedFiles.length, 1);
    assert.match(diff.summary, /1 file changed/);
    assert.match(diff.summary, /src\/history-output\.ts/);

    const undoAudit = createAuditLog();
    const undo = await undoSoloJob({ repoRoot, artifactRootDir, target: "last" }, { auditLog: undoAudit });
    assert.equal(undo.ok, true);
    await assert.rejects(() => fs.stat(path.join(repoRoot, "src", "history-output.ts")), /ENOENT/);
    assert.equal(undoAudit.events.some((event) => event.action === "solo.undo"), true);

    const manifestAfterUndo = JSON.parse(await fs.readFile(
      path.join(artifactRootDir, "job-history-test", ARTIFACT_PATHS.manifest),
      "utf8"
    ));
    assert.equal(manifestAfterUndo.status, "reverted");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("Solo continue seeds a new job from previous artifacts and verification failures", async () => {
  const repoRoot = await createGitRepo("solo-continue-");
  const artifactRootDir = path.join(repoRoot, ".orchestra", "jobs");

  try {
    await runSoloJob({
      task: "Create a file that still needs fixes.",
      executionMode: "normal",
      repoRoot,
      providerId: "codex",
      artifactRootDir
    }, {
      provider: fakeProvider("src/needs-fix.ts"),
      createJobId: () => "job-needs-fix"
    });

    const continueAudit = createAuditLog();
    const continued = await continueSoloJob({
      repoRoot,
      artifactRootDir,
      target: "last",
      fixVerification: true,
      providerId: "codex"
    }, {
      run: async (input) => ({
        ok: true,
        jobId: "job-continued",
        artifactRoot: path.join(artifactRootDir, "job-continued"),
        summary: input.task,
        changedFiles: [],
        guardStatus: "passed",
        verificationStatus: "passed"
      }),
      auditLog: continueAudit
    });

    assert.equal(continued.sourceJobId, "job-needs-fix");
    assert.equal(continued.run.jobId, "job-continued");
    assert.match(continued.prompt, /Continue Orchestra Solo job job-needs-fix/);
    assert.match(continued.prompt, /Fix verification failures/);
    assert.match(continued.prompt, /src\/needs-fix\.ts/);
    assert.equal(continueAudit.events.some((event) => event.action === "solo.continue"), true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("Solo commit helper generates a message and commits only job changed files", async () => {
  const repoRoot = await createGitRepo("solo-commit-");
  const artifactRootDir = path.join(repoRoot, ".orchestra", "jobs");

  try {
    await runSoloJob({
      task: "Create solo commit output.",
      executionMode: "normal",
      repoRoot,
      providerId: "codex",
      artifactRootDir
    }, {
      provider: fakeProvider("src/commit-output.ts"),
      createJobId: () => "job-commit-test"
    });

    const message = await buildSoloCommitMessage({ repoRoot, artifactRootDir, target: "job-commit-test" });
    assert.match(message, /Create solo commit output/);
    assert.match(message, /src\/commit-output\.ts/);
    assert.match(message, /Verification: passed/);

    const audit = createAuditLog();
    const commit = await commitSoloJob({ repoRoot, artifactRootDir, target: "job-commit-test" }, { auditLog: audit });
    assert.equal(commit.ok, true);
    assert.equal(commit.jobId, "job-commit-test");
    assert.equal(commit.changedFiles.includes("src/commit-output.ts"), true);
    assert.equal(commit.commitSha.length > 0, true);

    const status = await runCommand({
      command: "git",
      args: ["status", "--porcelain", "--", "src/commit-output.ts"],
      cwd: repoRoot
    });
    assert.equal(status.stdout.trim(), "");

    const manifestAfterCommit = JSON.parse(await fs.readFile(
      path.join(artifactRootDir, "job-commit-test", ARTIFACT_PATHS.manifest),
      "utf8"
    ));
    assert.equal(manifestAfterCommit.repo.gitCommitAfter, commit.commitSha);
    assert.equal(audit.events.some((event) => event.action === "solo.commit"), true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# solo jobs test\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify({
    name: "solo-jobs-test",
    private: true,
    type: "module"
  }, null, 2), "utf8");
  await runCommand({ command: "git", args: ["add", "."], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}

function fakeProvider(filePath: string): WorkerProviderAdapter {
  return {
    id: "codex",
    async isAvailable() {
      return true;
    },
    async execute(input) {
      await fs.mkdir(path.dirname(path.join(input.worktreePath, filePath)), { recursive: true });
      await fs.writeFile(path.join(input.worktreePath, filePath), "export const historyOutput = true;\n", "utf8");
      return {
        ok: true,
        summary: "Fake provider completed.",
        stdout: [
          "ORCHESTRA_CONTEXT_PACK:",
          JSON.stringify({
            summary: "Solo history context",
            relevantFiles: [{
              path: filePath,
              reason: "Requested output",
              status: "proposed",
              role: "unknown"
            }],
            allowedDiffBoundary: ["src/**"],
            doNotTouch: [],
            conventions: {},
            implementationPlan: ["Create the history output file"],
            verificationCommands: [],
            assumptions: [],
            missingContextWarnings: [],
            confidence: "high"
          })
        ].join("\n"),
        stderr: "",
        changedFiles: [filePath]
      };
    }
  };
}

function createAuditLog(): AuditLogRepository & { events: Array<{ action: string; details?: Record<string, unknown> }> } {
  return {
    events: [] as Array<{ action: string; details?: Record<string, unknown> }>,
    setOnEvent() {},
    async list() {
      return [];
    },
    async runRetentionCleanup() {
      return 0;
    },
    async append(event: { action: string; details?: Record<string, unknown> }) {
      this.events.push(event);
      return {
        version: 1,
        id: `event-${this.events.length}`,
        timestamp: "2026-06-12T00:00:00.000Z",
        actor: { id: "test", role: "operator" },
        ...event
      };
    }
  };
}
