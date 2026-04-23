import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { collectReviewChanges, parseGitDiffNameStatus, parseGitStatusPaths } from "../ai-system/core/current-change-review.js";

const execFileAsync = promisify(execFile);

test("parseGitStatusPaths extracts modified, renamed, deleted, and untracked paths", () => {
  const output = [
    " M src/changed.ts",
    "A  src/new.ts",
    "R  src/old-name.ts -> src/new-name.ts",
    " D src/deleted.ts",
    "?? src/untracked.ts"
  ].join("\n");

  assert.deepEqual(parseGitStatusPaths(output), [
    "src/changed.ts",
    "src/new.ts",
    "src/new-name.ts",
    "src/deleted.ts",
    "src/untracked.ts"
  ]);
});

test("parseGitDiffNameStatus extracts renamed destinations and statuses", () => {
  const output = [
    "M\tsrc/changed.ts",
    "A\tsrc/new.ts",
    "R100\tsrc/old-name.ts\tsrc/new-name.ts",
    "D\tsrc/deleted.ts"
  ].join("\n");

  assert.deepEqual(parseGitDiffNameStatus(output), [
    { status: "M", path: "src/changed.ts" },
    { status: "A", path: "src/new.ts" },
    { status: "R100", path: "src/new-name.ts" },
    { status: "D", path: "src/deleted.ts" }
  ]);
});

test("collectReviewChanges supports staged and base-ref review targets", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-review-targets-"));

  try {
    await execGit(repoRoot, ["init"]);
    await execGit(repoRoot, ["config", "user.email", "ai@example.com"]);
    await execGit(repoRoot, ["config", "user.name", "AI System"]);
    await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "src/example.ts"), "export const value = 1;\n", "utf8");
    await execGit(repoRoot, ["add", "src/example.ts"]);
    await execGit(repoRoot, ["commit", "-m", "initial"]);

    await fs.writeFile(path.join(repoRoot, "src/example.ts"), "export const value = 2;\n", "utf8");
    await execGit(repoRoot, ["add", "src/example.ts"]);
    await fs.writeFile(path.join(repoRoot, "src/example.ts"), "export const value = 3;\n", "utf8");

    const staged = await collectReviewChanges(repoRoot, { mode: "staged" });
    assert.deepEqual(staged.changedFiles, ["src/example.ts"]);
    assert.equal(staged.originalFiles[0]?.content, "export const value = 1;\n");
    assert.equal(staged.candidateFiles[0]?.content, "export const value = 2;\n");

    const base = await collectReviewChanges(repoRoot, { mode: "base-ref", baseRef: "HEAD" });
    assert.deepEqual(base.changedFiles, ["src/example.ts"]);
    assert.equal(base.originalFiles[0]?.content, "export const value = 1;\n");
    assert.equal(base.candidateFiles[0]?.content, "export const value = 3;\n");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

async function execGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
