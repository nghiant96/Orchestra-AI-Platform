import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_PATHS, checkLogPath, phaseArtifactPath } from "../ai-system/artifacts/artifact-paths.js";
import { LocalArtifactStore } from "../ai-system/artifacts/local-artifact-store.js";
import { removeTempDir } from "./test-utils.js";
import {
  updateManifestArtifactRefs,
  updateManifestStatus,
  updateManifestSummary
} from "../ai-system/artifacts/manifest-writer.js";

test("artifact paths are normalized relative paths", () => {
  assert.equal(phaseArtifactPath("Setup 01"), "phases/setup-01.json");
  assert.equal(checkLogPath("Type Check"), "verification/checks/type-check.log");
  for (const artifactPath of Object.values(ARTIFACT_PATHS)) {
    assert.equal(path.isAbsolute(artifactPath), false);
    assert.equal(artifactPath.includes("\\"), false);
  }
});

test("LocalArtifactStore creates, writes, reads, and lists unified jobs", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-artifact-store-"));
  const repoRoot = path.join(tmpDir, "repo");
  const rootDir = path.join(tmpDir, "jobs");
  const store = new LocalArtifactStore(rootDir);

  try {
    await fs.mkdir(repoRoot, { recursive: true });
    const ref = await store.createJob({
      jobId: "job-1",
      mode: "solo",
      executionMode: "normal",
      task: {
        title: "Fix login",
        prompt: "Fix login loading state.",
        createdAt: "2026-06-12T00:00:00.000Z"
      },
      repo: {
        root: repoRoot,
        branch: undefined
      },
      provider: {
        id: "codex",
        command: undefined
      }
    });

    await store.writeArtifact("job-1", {
      path: ARTIFACT_PATHS.contextPack,
      content: "{\"version\":1}\n"
    });
    await updateManifestStatus(ref.artifactRoot, "running");
    await updateManifestArtifactRefs(ref.artifactRoot, {
      task: ARTIFACT_PATHS.task,
      contextPack: ARTIFACT_PATHS.contextPack
    });
    await updateManifestSummary(ref.artifactRoot, {
      changedFileCount: 2,
      guardStatus: "passed",
      verificationStatus: "passed"
    });

    const manifest = await store.readManifest("job-1");
    const contextPack = await store.readArtifact("job-1", ARTIFACT_PATHS.contextPack);
    const jobs = await store.listJobs({ mode: "solo" });
    const rawManifest = JSON.parse(await fs.readFile(ref.manifestPath, "utf8"));

    assert.equal(manifest.status, "running");
    assert.equal(manifest.artifacts.contextPack, ARTIFACT_PATHS.contextPack);
    assert.equal(contextPack?.toString(), "{\"version\":1}\n");
    assert.equal(jobs[0]?.changedFileCount, 2);
    assert.equal(rawManifest.task.title, "Fix login");
    assert.equal("branch" in rawManifest.repo, false);
    assert.equal("command" in rawManifest.provider, false);
    assert.equal(
      await fs.readFile(path.join(ref.artifactRoot, ARTIFACT_PATHS.task), "utf8"),
      "Fix login loading state.\n"
    );
  } finally {
    await removeTempDir(tmpDir);
  }
});

test("LocalArtifactStore rejects paths that escape the job root", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-artifact-escape-"));
  const store = new LocalArtifactStore(path.join(tmpDir, "jobs"));

  try {
    await assert.rejects(
      () => store.writeArtifact("job-1", { path: "../outside.txt", content: "nope" }),
      /Invalid artifact path/
    );
    await assert.rejects(
      () => store.writeArtifact("../job-1", { path: "artifact.txt", content: "nope" }),
      /Invalid artifact job id/
    );
  } finally {
    await removeTempDir(tmpDir);
  }
});
