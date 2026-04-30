import fs from "node:fs/promises";
import path from "node:path";
import type { Logger, ReviewIssue, RulesConfig } from "../types.js";
import { loadRules } from "./orchestrator-runtime.js";
import { loadRecentRunSummary, loadRunSummary, persistApplyEvent } from "./artifacts.js";
import { hasBlockingIssues, summarizeIssueCounts } from "./reviewer.js";
import { readOriginalFiles, writeFilesAtomically } from "./context.js";

export interface ArtifactApplyResult {
  repoRoot: string;
  runPath: string;
  iterationPath: string;
  manifestPath: string;
  task: string;
  dryRun: boolean;
  wroteFiles: boolean;
  appliedFiles: string[];
  reviewSummary: string;
  issueCounts: Record<"high" | "medium" | "low", number>;
  force: boolean;
  applyEventPath: string;
}

export async function applyArtifactCandidate({
  repoRoot,
  configPath,
  target,
  dryRun,
  force,
  logger
}: {
  repoRoot: string;
  configPath: string | null;
  target: string;
  dryRun: boolean;
  force: boolean;
  logger?: Logger;
}): Promise<ArtifactApplyResult> {
  const { rules } = await loadRules(repoRoot, configPath);
  const artifact = await loadArtifactCandidate(repoRoot, rules, target);

  if (!force && hasBlockingIssues(artifact.issues)) {
    throw new Error(
      `Artifact has blocking review issues. Re-run with --force if you still want to apply it. Summary: ${artifact.reviewSummary || "no review summary"}`
    );
  }

  const originals = await readOriginalFiles(repoRoot, artifact.candidateFiles.map((file) => file.path));
  if (!dryRun) {
    logger?.step(`Applying ${artifact.candidateFiles.length} file(s) from ${artifact.iterationPath}`);
    await writeFilesAtomically(repoRoot, artifact.candidateFiles, originals);
  }

  const applyEventPath = await persistApplyEvent(
    artifact.runPath,
    {
      version: 1,
      task: artifact.task,
      dryRun,
      force,
      wroteFiles: !dryRun,
      appliedFiles: artifact.candidateFiles.map((file) => file.path),
      reviewSummary: artifact.reviewSummary,
      issueCounts: summarizeIssueCounts(artifact.issues),
      iterationPath: artifact.iterationPath,
      manifestPath: artifact.manifestPath
    },
    logger
  );

  return {
    repoRoot,
    runPath: artifact.runPath,
    iterationPath: artifact.iterationPath,
    manifestPath: artifact.manifestPath,
    task: artifact.task,
    dryRun,
    wroteFiles: !dryRun,
    appliedFiles: artifact.candidateFiles.map((file) => file.path),
    reviewSummary: artifact.reviewSummary,
    issueCounts: summarizeIssueCounts(artifact.issues),
    force,
    applyEventPath
  };
}

export async function loadArtifactCandidate(repoRoot: string, rules: RulesConfig, target: string): Promise<{
  runPath: string;
  iterationPath: string;
  manifestPath: string;
  task: string;
  reviewSummary: string;
  issues: ReviewIssue[];
  candidateFiles: import("../types.js").GeneratedFile[];
}> {
  const iterationPath = await resolveIterationPath(repoRoot, rules, target);
  const manifestPath = path.join(iterationPath, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
    task?: string;
    reviewSummary?: string;
    issues?: ReviewIssue[];
    candidateFiles?: Array<{ path: string; action?: "create" | "update" }>;
  };
  const filesRoot = path.join(iterationPath, "files");
  const candidateFiles = [];

  for (const file of manifest.candidateFiles ?? []) {
    if (!file?.path) {
      continue;
    }
    const content = await fs.readFile(path.join(filesRoot, file.path), "utf8");
    candidateFiles.push({
      path: file.path,
      action: file.action === "create" ? "create" : "update",
      content
    } as import("../types.js").GeneratedFile);
  }

  return {
    runPath: path.dirname(iterationPath),
    iterationPath,
    manifestPath,
    task: manifest.task ?? "",
    reviewSummary: manifest.reviewSummary ?? "",
    issues: Array.isArray(manifest.issues) ? manifest.issues : [],
    candidateFiles
  };
}

async function resolveIterationPath(repoRoot: string, rules: RulesConfig, target: string): Promise<string> {
  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget || normalizedTarget === "last") {
    const summary = await loadRecentRunSummary(repoRoot, rules, "last");
    const latestIterationPath = summary.runState.artifacts?.latestIterationPath ?? summary.artifactIndex?.latestIterationPath;
    if (!latestIterationPath) {
      throw new Error("Latest run does not contain iteration artifacts to apply.");
    }
    return latestIterationPath;
  }

  const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
  const repoRelative = path.resolve(repoRoot, normalizedTarget);
  const artifactRelative = path.join(artifactsDir, normalizedTarget);
  const absoluteTarget = path.isAbsolute(normalizedTarget)
    ? normalizedTarget
    : (await pathExists(repoRelative))
      ? repoRelative
      : artifactRelative;

  if (absoluteTarget.endsWith(`${path.sep}manifest.json`) || absoluteTarget.endsWith("/manifest.json")) {
    return path.dirname(absoluteTarget);
  }
  if (absoluteTarget.endsWith(`${path.sep}run-state.json`) || absoluteTarget.endsWith("/run-state.json")) {
    const summary = await loadRunSummary(repoRoot, rules, absoluteTarget);
    const latestIterationPath = summary.runState.artifacts?.latestIterationPath ?? summary.artifactIndex?.latestIterationPath;
    if (!latestIterationPath) {
      throw new Error(`Run ${absoluteTarget} does not contain iteration artifacts to apply.`);
    }
    return latestIterationPath;
  }

  const stat = await fs.stat(absoluteTarget);
  if (!stat.isDirectory()) {
    throw new Error(`Artifact target is not a directory: ${absoluteTarget}`);
  }

  if (path.basename(absoluteTarget).startsWith("iteration-")) {
    return absoluteTarget;
  }

  const summary = await loadRunSummary(repoRoot, rules, absoluteTarget);
  const latestIterationPath = summary.runState.artifacts?.latestIterationPath ?? summary.artifactIndex?.latestIterationPath;
  if (!latestIterationPath) {
    throw new Error(`Run ${absoluteTarget} does not contain iteration artifacts to apply.`);
  }
  return latestIterationPath;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
