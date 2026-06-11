import fs from "node:fs/promises";
import path from "node:path";
import type { DiffSummary } from "../types.js";
import { runCommand } from "../utils/api.js";
import { ARTIFACT_PATHS } from "./artifact-paths.js";

export interface GitArtifactCaptureResult {
  changedFiles: string[];
  diffText: string;
  diffStat: string;
  diffSummaries: DiffSummary[];
}

export async function captureGitArtifacts(input: {
  repoRoot: string;
  artifactRoot: string;
}): Promise<GitArtifactCaptureResult> {
  const pathspec = ["--", ".", ":(exclude).orchestra/**"];
  const status = await git(input.repoRoot, ["status", "--porcelain", "--untracked-files=all", ...pathspec]);
  const changedFiles = parseChangedFiles(status);
  const untrackedFiles = parseUntrackedFiles(status);

  if (untrackedFiles.length > 0) {
    await git(input.repoRoot, ["add", "-N", "--", ...untrackedFiles]);
  }

  try {
    const [diffText, diffStat, numStat] = await Promise.all([
      git(input.repoRoot, ["diff", "--binary", ...pathspec]),
      git(input.repoRoot, ["diff", "--stat", ...pathspec]),
      git(input.repoRoot, ["diff", "--numstat", ...pathspec])
    ]);
    const diffSummaries = parseNumStat(numStat);

    await fs.mkdir(path.join(input.artifactRoot, "diff"), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(input.artifactRoot, ARTIFACT_PATHS.diffPatch), diffText, "utf8"),
      fs.writeFile(path.join(input.artifactRoot, ARTIFACT_PATHS.diffStat), diffStat, "utf8"),
      fs.writeFile(
        path.join(input.artifactRoot, ARTIFACT_PATHS.changedFiles),
        `${JSON.stringify(changedFiles, null, 2)}\n`,
        "utf8"
      )
    ]);

    return { changedFiles, diffText, diffStat, diffSummaries };
  } finally {
    if (untrackedFiles.length > 0) {
      await git(input.repoRoot, ["reset", "--", ...untrackedFiles]);
    }
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand({ command: "git", args, cwd, timeoutMs: 30000 });
  return result.stdout;
}

function parseChangedFiles(status: string): string[] {
  return [...new Set(status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((line) => line.includes(" -> ") ? line.split(" -> ").pop() || line : line)
    .filter(Boolean))]
    .sort();
}

function parseUntrackedFiles(status: string): string[] {
  return status
    .split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function parseNumStat(numStat: string): DiffSummary[] {
  return numStat.split(/\r?\n/).filter(Boolean).map((line) => {
    const [addedRaw, removedRaw, filePath = ""] = line.split("\t");
    const addedLines = Number(addedRaw);
    const removedLines = Number(removedRaw);
    const safeAdded = Number.isFinite(addedLines) ? addedLines : 0;
    const safeRemoved = Number.isFinite(removedLines) ? removedLines : 0;
    return {
      path: filePath,
      beforeLineCount: 0,
      afterLineCount: 0,
      addedLines: safeAdded,
      removedLines: safeRemoved,
      changedLineEstimate: safeAdded + safeRemoved
    };
  });
}
