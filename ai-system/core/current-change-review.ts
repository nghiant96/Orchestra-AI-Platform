import fs from "node:fs/promises";
import type { Logger, ReviewIssue, ToolExecutionResult } from "../types.js";
import { loadOrchestratorRuntime } from "./orchestrator-runtime.js";
import { buildDiffSummaries, mergeIssues, normalizeReviewResult, summarizeIssueCounts, validateCandidateFiles } from "./reviewer.js";
import { runToolChecks } from "./tool-executor.js";
import { buildExecutionSummary, measureExecutionStep } from "./execution-summary.js";
import { readOriginalFiles, resolveRepoPath } from "./context.js";
import { runCommand } from "../utils/api.js";
import { loadEnvironment } from "../utils/api.js";

export type ReviewTargetMode = "working-tree" | "staged" | "base-ref";

export interface CurrentChangeReviewResult {
  repoRoot: string;
  configPath: string | null;
  task: string;
  targetMode: ReviewTargetMode;
  targetDetail: string | null;
  changedFiles: string[];
  providers: {
    planner: string;
    reviewer: string;
    generator: string;
    fixer: string;
  };
  latestToolResults: ToolExecutionResult[];
  reviewSummary: string;
  issues: ReviewIssue[];
  issueCounts: Record<"high" | "medium" | "low", number>;
  execution: import("../types.js").ExecutionSummary;
}

export async function reviewCurrentRepoChanges({
  repoRoot,
  configPath,
  providerPreset,
  task,
  targetMode = "working-tree",
  targetDetail = null,
  logger
}: {
  repoRoot: string;
  configPath: string | null;
  providerPreset: string | null;
  task: string;
  targetMode?: ReviewTargetMode;
  targetDetail?: string | null;
  logger: Logger;
}): Promise<CurrentChangeReviewResult | null> {
  const executionSteps: import("../types.js").ExecutionStepSummary[] = [];
  const effectiveTask =
    task.trim() ||
    (targetMode === "staged"
      ? "Review staged changes."
      : targetMode === "base-ref"
        ? `Review changes against base ref ${targetDetail ?? "(unknown)"}`
        : "Review current working tree changes.");
  const resolvedRepoRoot = await fs.realpath(repoRoot);
  await loadEnvironment(resolvedRepoRoot);
  const changesStep = await measureExecutionStep(
    executionSteps,
    "detect-current-changes",
    async () => await collectReviewChanges(resolvedRepoRoot, { mode: targetMode, baseRef: targetDetail }),
    buildReviewDetectionDetail(targetMode, targetDetail)
  );
  const changes = changesStep.result;
  if (changes.changedFiles.length === 0) {
    return null;
  }

  const { configPath: loadedConfigPath, runtime } = await loadOrchestratorRuntime({
    repoRoot: resolvedRepoRoot,
    explicitConfigPath: configPath,
    logger,
    task: effectiveTask
  });

  if (providerPreset) {
    // provider preset env has already been applied in CLI; this branch keeps intent visible in review metadata.
    logger.info(`Review workflow using provider preset ${providerPreset}.`);
  }

  const toolStep = await measureExecutionStep(
    executionSteps,
    "tool-checks",
    async () =>
      await runToolChecks({
        repoRoot,
        changedFiles: changes.candidateFiles,
        rules: runtime.reviewer.rules,
        logger
      }),
    "Ran tool checks against the current working tree changes."
  );
  const toolExecution = toolStep.result;
  const validationIssues = validateCandidateFiles(changes.candidateFiles);
  const preReviewIssues = mergeIssues(toolExecution.issues, validationIssues);

  const reviewStep = await measureExecutionStep(
    executionSteps,
    "review-current-changes",
    async () =>
      normalizeReviewResult(
        await runtime.reviewer.reviewCode(
          effectiveTask,
          changes.originalFiles,
          changes.candidateFiles,
          preReviewIssues,
          changes.diffSummaries,
          resolvedRepoRoot,
          ""
        )
      ),
    `Reviewed ${changes.changedFiles.length} changed file(s) with ${runtime.reviewerProvider.id}.`
  );
  const review = reviewStep.result;
  const issues = mergeIssues(review.issues, preReviewIssues);

  return {
    repoRoot: resolvedRepoRoot,
    configPath: loadedConfigPath,
    task: effectiveTask,
    targetMode,
    targetDetail,
    changedFiles: changes.changedFiles,
    providers: runtime.providerSummary,
    latestToolResults: toolExecution.results,
    reviewSummary: review.summary,
    issues,
    issueCounts: summarizeIssueCounts(issues),
    execution: buildExecutionSummary({
      status: issues.some((issue) => issue.severity === "high" || issue.severity === "medium") ? "failed" : "completed",
      steps: executionSteps,
      finalIssues: issues,
      latestToolResults: toolExecution.results,
      iterations: []
    })
  };
}

export function parseGitStatusPaths(output: string): string[] {
  const files = new Set<string>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    const pathPart = line.slice(3).trim();
    if (!pathPart) {
      continue;
    }

    const normalized = pathPart.includes(" -> ") ? pathPart.split(" -> ").at(-1) ?? "" : pathPart;
    if (normalized) {
      files.add(normalized);
    }
  }

  return [...files];
}

export function parseGitDiffNameStatus(output: string): Array<{ path: string; status: string }> {
  const changes: Array<{ path: string; status: string }> = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parts = line.split("\t").filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const status = parts[0] ?? "";
    const pathPart = status.startsWith("R") || status.startsWith("C") ? parts.at(-1) ?? "" : parts[1] ?? "";
    if (!pathPart) {
      continue;
    }

    changes.push({
      status,
      path: pathPart.replace(/\\/g, "/").replace(/^\.\/+/, "")
    });
  }

  return changes;
}

export async function collectReviewChanges(
  repoRoot: string,
  target: { mode: ReviewTargetMode; baseRef?: string | null }
): Promise<{
  changedFiles: string[];
  candidateFiles: import("../types.js").GeneratedFile[];
  originalFiles: Array<{ path: string; content?: string | null }>;
  diffSummaries: import("../types.js").DiffSummary[];
}> {
  switch (target.mode) {
    case "staged":
      return await collectStagedChanges(repoRoot);
    case "base-ref":
      return await collectBaseRefChanges(repoRoot, target.baseRef ?? "");
    case "working-tree":
    default:
      return await collectWorkingTreeChanges(repoRoot);
  }
}

async function collectWorkingTreeChanges(repoRoot: string): Promise<{
  changedFiles: string[];
  candidateFiles: import("../types.js").GeneratedFile[];
  originalFiles: Array<{ path: string; content?: string | null }>;
  diffSummaries: import("../types.js").DiffSummary[];
}> {
  const status = await runCommand({
    command: "git",
    args: ["status", "--porcelain", "--untracked-files=all"],
    cwd: repoRoot,
    timeoutMs: 30000
  });
  const changedFiles = parseGitStatusPaths(status.stdout)
    .map((filePath) => filePath.replace(/\\/g, "/").replace(/^\.\/+/, ""))
    .filter(Boolean);

  if (changedFiles.length === 0) {
    return {
      changedFiles: [],
      candidateFiles: [],
      originalFiles: [],
      diffSummaries: []
    };
  }

  const originalsMap = await readOriginalFiles(repoRoot, changedFiles);
  const originalFiles = changedFiles.map((filePath) => ({
    path: filePath,
    content: originalsMap.get(filePath) ?? null
  }));

  const candidateFiles = [];
  for (const filePath of changedFiles) {
    const absolutePath = resolveRepoPath(repoRoot, filePath);
    let content = "";
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      content = "";
    }
    candidateFiles.push({
      path: filePath,
      action: originalsMap.get(filePath) === null ? "create" : "update",
      content
    } as import("../types.js").GeneratedFile);
  }

  return {
    changedFiles,
    candidateFiles,
    originalFiles,
    diffSummaries: buildDiffSummaries(originalFiles, candidateFiles)
  };
}

async function collectStagedChanges(repoRoot: string): Promise<{
  changedFiles: string[];
  candidateFiles: import("../types.js").GeneratedFile[];
  originalFiles: Array<{ path: string; content?: string | null }>;
  diffSummaries: import("../types.js").DiffSummary[];
}> {
  const diff = await runCommand({
    command: "git",
    args: ["diff", "--cached", "--name-status", "--find-renames", "--diff-filter=ACDMR"],
    cwd: repoRoot,
    timeoutMs: 30000
  });
  const changes = parseGitDiffNameStatus(diff.stdout);
  const changedFiles = changes.map((entry) => entry.path);
  if (changedFiles.length === 0) {
    return {
      changedFiles: [],
      candidateFiles: [],
      originalFiles: [],
      diffSummaries: []
    };
  }

  const originalFiles = await readGitRevisionFiles(repoRoot, "HEAD", changedFiles);
  const candidateFiles = await Promise.all(
    changes.map(async (change) => ({
      path: change.path,
      action: (await readGitObject(repoRoot, `:${change.path}`)) === null ? "update" : originalFiles.find((file) => file.path === change.path)?.content === null ? "create" : "update",
      content: (await readGitObject(repoRoot, `:${change.path}`)) ?? ""
    }))
  );

  return {
    changedFiles,
    candidateFiles: candidateFiles as import("../types.js").GeneratedFile[],
    originalFiles,
    diffSummaries: buildDiffSummaries(originalFiles, candidateFiles as import("../types.js").GeneratedFile[])
  };
}

async function collectBaseRefChanges(repoRoot: string, baseRef: string): Promise<{
  changedFiles: string[];
  candidateFiles: import("../types.js").GeneratedFile[];
  originalFiles: Array<{ path: string; content?: string | null }>;
  diffSummaries: import("../types.js").DiffSummary[];
}> {
  const normalizedBaseRef = baseRef.trim();
  if (!normalizedBaseRef) {
    throw new Error("Missing base ref for review. Use `ai review --base <git-ref>`.");
  }

  const diff = await runCommand({
    command: "git",
    args: ["diff", "--name-status", "--find-renames", "--diff-filter=ACDMR", normalizedBaseRef, "--"],
    cwd: repoRoot,
    timeoutMs: 30000
  });
  const changes = parseGitDiffNameStatus(diff.stdout);
  const changedFiles = changes.map((entry) => entry.path);
  if (changedFiles.length === 0) {
    return {
      changedFiles: [],
      candidateFiles: [],
      originalFiles: [],
      diffSummaries: []
    };
  }

  const originalFiles = await readGitRevisionFiles(repoRoot, normalizedBaseRef, changedFiles);
  const originalMap = new Map(originalFiles.map((file) => [file.path, file.content ?? null]));
  const candidateFiles = [];
  for (const filePath of changedFiles) {
    const absolutePath = resolveRepoPath(repoRoot, filePath);
    let content = "";
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      content = "";
    }
    candidateFiles.push({
      path: filePath,
      action: originalMap.get(filePath) === null ? "create" : "update",
      content
    } as import("../types.js").GeneratedFile);
  }

  return {
    changedFiles,
    candidateFiles,
    originalFiles,
    diffSummaries: buildDiffSummaries(originalFiles, candidateFiles)
  };
}

async function readGitRevisionFiles(
  repoRoot: string,
  revision: string,
  filePaths: string[]
): Promise<Array<{ path: string; content?: string | null }>> {
  const originals = [];
  for (const filePath of filePaths) {
    originals.push({
      path: filePath,
      content: await readGitObject(repoRoot, `${revision}:${filePath}`)
    });
  }
  return originals;
}

async function readGitObject(repoRoot: string, objectSpec: string): Promise<string | null> {
  try {
    const result = await runCommand({
      command: "git",
      args: ["show", objectSpec],
      cwd: repoRoot,
      timeoutMs: 30000
    });
    return result.stdout;
  } catch {
    return null;
  }
}

function buildReviewDetectionDetail(targetMode: ReviewTargetMode, targetDetail: string | null): string {
  switch (targetMode) {
    case "staged":
      return "Scanned staged changes for reviewable diffs.";
    case "base-ref":
      return `Scanned changes against base ref ${targetDetail ?? "(unknown)"} for reviewable diffs.`;
    case "working-tree":
    default:
      return "Scanned the current working tree for reviewable changes.";
  }
}
