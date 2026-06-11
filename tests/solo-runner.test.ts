import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { runSoloJob } from "../ai-system/solo/solo-runner.js";
import { runCommand } from "../ai-system/utils/api.js";
import type { WorkerProviderAdapter } from "../ai-system/worker/providers/provider-adapter.js";

test("SoloRunner creates unified artifacts and an undo-ready patch", async () => {
  const repoRoot = await createGitRepo("solo-runner-");
  const artifactRootDir = path.join(repoRoot, ".orchestra", "jobs");

  try {
    const result = await runSoloJob({
      task: "Add a focused solo output file.",
      executionMode: "normal",
      repoRoot,
      providerId: "codex",
      artifactRootDir
    }, {
      provider: fakeProvider(),
      createJobId: () => "job-solo-test"
    });

    assert.equal(result.ok, true);
    assert.equal(result.jobId, "job-solo-test");
    assert.equal(result.changedFiles.includes("src/solo-output.ts"), true);

    const manifest = JSON.parse(await fs.readFile(path.join(result.artifactRoot, ARTIFACT_PATHS.manifest), "utf8"));
    assert.equal(manifest.mode, "solo");
    assert.equal(manifest.status, "completed");
    assert.equal(manifest.repo.gitCommitBefore.length > 0, true);
    assert.equal(manifest.artifacts.diffPatch, ARTIFACT_PATHS.diffPatch);
    assert.equal(manifest.artifacts.verification, ARTIFACT_PATHS.verification);

    for (const artifactPath of [
      ARTIFACT_PATHS.contextPack,
      ARTIFACT_PATHS.contextPackMarkdown,
      ARTIFACT_PATHS.repoConventions,
      ARTIFACT_PATHS.providerStdout,
      ARTIFACT_PATHS.providerStderr,
      ARTIFACT_PATHS.diffPatch,
      ARTIFACT_PATHS.diffStat,
      ARTIFACT_PATHS.changedFiles,
      ARTIFACT_PATHS.diffBoundaryCheck,
      ARTIFACT_PATHS.namingCheck,
      ARTIFACT_PATHS.verification
    ]) {
      await fs.access(path.join(result.artifactRoot, artifactPath));
    }

    await runCommand({
      command: "git",
      args: ["apply", "--check", "-R", path.join(result.artifactRoot, ARTIFACT_PATHS.diffPatch)],
      cwd: repoRoot
    });
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("SoloRunner refuses to mix a new job with existing working tree changes", async () => {
  const repoRoot = await createGitRepo("solo-runner-dirty-");
  let providerCalled = false;

  try {
    await fs.writeFile(path.join(repoRoot, "README.md"), "# dirty\n", "utf8");

    await assert.rejects(() => runSoloJob({
      task: "Do not run on dirty state.",
      executionMode: "safe",
      repoRoot,
      providerId: "codex",
      artifactRootDir: path.join(repoRoot, ".orchestra", "jobs")
    }, {
      provider: {
        ...fakeProvider(),
        async execute(input) {
          providerCalled = true;
          return fakeProvider().execute(input);
        }
      },
      createJobId: () => "job-dirty-test"
    }), /clean working tree/i);

    assert.equal(providerCalled, false);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

function fakeProvider(): WorkerProviderAdapter {
  return {
    id: "codex",
    async isAvailable() {
      return true;
    },
    async execute(input) {
      await fs.mkdir(path.join(input.worktreePath, "src"), { recursive: true });
      await fs.writeFile(
        path.join(input.worktreePath, "src", "solo-output.ts"),
        "export const soloOutput = true;\n",
        "utf8"
      );
      return {
        ok: true,
        summary: "Fake provider completed.",
        stdout: [
          "ORCHESTRA_CONTEXT_PACK:",
          JSON.stringify({
            summary: "Solo output context",
            relevantFiles: [{
              path: "src/solo-output.ts",
              reason: "Requested output",
              status: "proposed",
              role: "unknown"
            }],
            allowedDiffBoundary: ["src/**"],
            doNotTouch: [],
            conventions: {},
            implementationPlan: ["Create the output file"],
            verificationCommands: [],
            assumptions: [],
            missingContextWarnings: [],
            confidence: "high"
          })
        ].join("\n"),
        stderr: "",
        changedFiles: ["src/solo-output.ts"]
      };
    }
  };
}

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# solo test\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify({
    name: "solo-runner-test",
    private: true,
    type: "module"
  }, null, 2), "utf8");
  await runCommand({ command: "git", args: ["add", "."], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}
