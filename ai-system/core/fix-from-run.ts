import { loadRules } from "./orchestrator-runtime.js";
import { loadRunSummary } from "./artifacts.js";
import type { Logger, ToolExecutionResult } from "../types.js";

export interface FixFromRunPreparation {
  target: string;
  repoRoot: string;
  task: string;
  resumable: boolean;
  resumeTarget: string | null;
  issueCounts: Record<"high" | "medium" | "low", number>;
  fileHints: string[];
  latestToolResults: ToolExecutionResult[];
  providers: {
    planner: string;
    reviewer: string;
    generator: string;
    fixer: string;
  };
}

export async function prepareFixFromRun({
  repoRoot,
  configPath,
  target,
  logger
}: {
  repoRoot: string;
  configPath: string | null;
  target: string;
  logger?: Logger;
}): Promise<FixFromRunPreparation> {
  const { rules } = await loadRules(repoRoot, configPath);
  const summary = await loadRunSummary(repoRoot, rules, target);
  const retryHint = summary.runState.execution?.retryHint ?? null;
  const resumable =
    summary.runState.status === "paused_after_plan" ||
    summary.runState.status === "paused_after_generate" ||
    (summary.runState.status === "failed" && retryHint !== null);

  const fileHints = [
    ...(summary.runState.result?.files?.map((file) => file.path) ?? []),
    ...(summary.artifactIndex?.latestFiles ?? []),
    ...(summary.runState.plan?.writeTargets ?? [])
  ].filter((value, index, array) => Boolean(value) && array.indexOf(value) === index).slice(0, 10);

  const latestToolResults = summary.runState.latestToolResults ?? summary.artifactIndex?.latestToolResults ?? [];
  const issueCounts = normalizeIssueCounts(summary.runState.issueCounts ?? {
    high: 0,
    medium: 0,
    low: 0
  });

  const task = resumable
    ? summary.runState.task ?? "Resume the previous failed run and continue fixing the remaining issues."
    : buildFixFromRunTask({
        baseTask: summary.runState.task ?? summary.artifactIndex?.latestTask ?? "Fix the previous run issues.",
        issueCounts,
        latestToolResults,
        latestReviewSummary: summary.runState.latestReviewSummary ?? "",
        fileHints
      });

  logger?.info(
    resumable
      ? `Using resumable run recovery for ${target}.`
      : `Building a follow-up fix task from prior run ${target}.`
  );

  return {
    target,
    repoRoot,
    task,
    resumable,
    resumeTarget: resumable ? summary.statePath : null,
    issueCounts,
    fileHints,
    latestToolResults,
    providers: summary.runState.providers ?? {
      planner: "unknown",
      reviewer: "unknown",
      generator: "unknown",
      fixer: "unknown"
    }
  };
}

function buildFixFromRunTask({
  baseTask,
  issueCounts,
  latestToolResults,
  latestReviewSummary,
  fileHints
}: {
  baseTask: string;
  issueCounts: Record<"high" | "medium" | "low", number>;
  latestToolResults: ToolExecutionResult[];
  latestReviewSummary: string;
  fileHints: string[];
}): string {
  const lines = [
    "Continue fixing a previous run that did not finish cleanly.",
    `Original task: ${baseTask}`,
    `Outstanding issues: high=${issueCounts.high}, medium=${issueCounts.medium}, low=${issueCounts.low}`
  ];

  const failingChecks = latestToolResults.filter((entry) => !entry.skipped && !entry.ok);
  if (failingChecks.length > 0) {
    lines.push("");
    lines.push("Latest failing checks:");
    for (const check of failingChecks) {
      lines.push(`- ${check.name}: ${check.summary}`);
    }
  }

  if (latestReviewSummary) {
    lines.push("");
    lines.push(`Previous review summary: ${latestReviewSummary}`);
  }

  if (fileHints.length > 0) {
    lines.push("");
    lines.push(`Likely related files: ${fileHints.join(", ")}`);
  }

  lines.push("");
  lines.push("Make the smallest safe change that resolves the remaining blocking issues and failing checks.");
  return lines.join("\n");
}

function normalizeIssueCounts(value: Record<string, number>): Record<"high" | "medium" | "low", number> {
  return {
    high: Number(value.high ?? 0),
    medium: Number(value.medium ?? 0),
    low: Number(value.low ?? 0)
  };
}
