import fs from "node:fs/promises";
import { loadEnvironment } from "../utils/api.js";
import { loadOrchestratorRuntime } from "./orchestrator-runtime.js";
import { runToolChecks } from "./tool-executor.js";
import { summarizeIssueCounts, mergeIssues } from "./reviewer.js";
import { buildExecutionSummary, measureExecutionStep } from "./execution-summary.js";
import { buildDiffSummaries } from "./reviewer.js";
import type { GeneratedFile, Logger, ReviewIssue, ToolExecutionResult } from "../types.js";
import { buildFixChecksTask } from "./fix-checks.js";

export interface FailingChecksReviewResult {
  repoRoot: string;
  configPath: string | null;
  task: string;
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
  fileHints: string[];
  execution: import("../types.js").ExecutionSummary;
}

export async function reviewFailingChecks({
  repoRoot,
  configPath,
  providerPreset,
  logger
}: {
  repoRoot: string;
  configPath: string | null;
  providerPreset: string | null;
  logger: Logger;
}): Promise<FailingChecksReviewResult | null> {
  const executionSteps: import("../types.js").ExecutionStepSummary[] = [];
  const resolvedRepoRoot = await fs.realpath(repoRoot);
  await loadEnvironment(resolvedRepoRoot);

  const { configPath: loadedConfigPath, runtime } = await loadOrchestratorRuntime({
    repoRoot: resolvedRepoRoot,
    explicitConfigPath: configPath,
    logger,
    task: "Review the currently failing repository checks."
  });

  if (providerPreset) {
    logger.info(`review --failing-checks workflow using provider preset ${providerPreset}.`);
  }

  const toolStep = await measureExecutionStep(
    executionSteps,
    "tool-checks",
    async () =>
      await runToolChecks({
        repoRoot: resolvedRepoRoot,
        changedFiles: [],
        rules: runtime.reviewer.rules,
        logger
      }),
    "Ran tool checks to locate failing repository checks."
  );
  const toolExecution = toolStep.result;
  const failingChecks = toolExecution.results.filter((entry) => !entry.skipped && !entry.ok);
  if (failingChecks.length === 0 && toolExecution.issues.length === 0) {
    return null;
  }

  const fileHints = await extractExistingFileHints(
    resolvedRepoRoot,
    failingChecks.flatMap((result) => [result.stdout ?? "", result.stderr ?? "", result.command ?? "", ...(result.args ?? [])])
  );
  const candidateFiles = await readCandidateFiles(resolvedRepoRoot, fileHints);
  const originalFiles = candidateFiles.map((file) => ({
    path: file.path,
    content: file.content
  }));
  const diffSummaries = buildDiffSummaries(originalFiles, candidateFiles);
  const reviewTask = buildFixChecksTask(failingChecks, fileHints);

  const reviewStep = await measureExecutionStep(
    executionSteps,
    "review-failing-checks",
    async () =>
      await runtime.reviewer.reviewCode(
        reviewTask,
        null,
        false,
        originalFiles,
        candidateFiles,
        toolExecution.issues,
        diffSummaries,
        resolvedRepoRoot,
        ""
      ),
    `Reviewed ${failingChecks.length} failing check(s) with ${runtime.reviewerProvider.id}.`
  );
  const normalized = mergeIssues(reviewStep.result.issues, toolExecution.issues);

  return {
    repoRoot: resolvedRepoRoot,
    configPath: loadedConfigPath,
    task: reviewTask,
    changedFiles: fileHints,
    providers: runtime.providerSummary,
    latestToolResults: toolExecution.results,
    reviewSummary: reviewStep.result.summary,
    issues: normalized,
    issueCounts: summarizeIssueCounts(normalized),
    fileHints,
    execution: buildExecutionSummary({
      status: normalized.some((issue) => issue.severity === "high" || issue.severity === "medium") ? "failed" : "completed",
      steps: executionSteps,
      providers: runtime.providerSummary,
      usageMetrics: runtime.reviewerProvider.getUsage?.() ?? [],
      finalIssues: normalized,
      latestToolResults: toolExecution.results,
      iterations: []
    })
  };
}

async function readCandidateFiles(repoRoot: string, fileHints: string[]): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  for (const relativePath of fileHints) {
    try {
      const content = await fs.readFile(new URL(relativePath, `file://${repoRoot}/`), "utf8");
      files.push({
        path: relativePath,
        action: "update",
        content
      });
    } catch {
      continue;
    }
  }
  return files;
}

async function extractExistingFileHints(repoRoot: string, snippets: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const hints: string[] = [];
  const pattern = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|yml|yaml|md))/g;

  for (const snippet of snippets) {
    for (const match of snippet.matchAll(pattern)) {
      const candidate = normalizeCandidatePath(match[1] ?? "");
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      try {
        const stat = await fs.stat(new URL(candidate, `file://${repoRoot}/`));
        if (!stat.isFile()) {
          continue;
        }
        seen.add(candidate);
        hints.push(candidate);
      } catch {
        continue;
      }
    }
  }

  return hints.slice(0, 8);
}

function normalizeCandidatePath(value: string): string | null {
  const trimmed = value.trim().replace(/^\.\/+/, "").replace(/[):,;]+$/, "");
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("../") || trimmed.includes("..\\") || trimmed.includes("\0")) {
    return null;
  }
  return trimmed.replace(/\\/g, "/");
}
