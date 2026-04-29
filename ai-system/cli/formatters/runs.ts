import type { RecentRunSummary, RunListEntry } from "../../core/artifacts.js";
import type { ArtifactApplyResult } from "../types.js";
import {
  formatDuration,
  formatExecutionBudget,
  summarizeToolResults,
  summarizeIssueCountsFromIssues,
  formatCost
} from "./shared.js";

export function printRecentRunSummary(summary: RecentRunSummary): void {
  const status = summary.runState.status ?? summary.artifactIndex?.latestStatus ?? "(unknown)";
  const latestToolResults = summary.runState.latestToolResults ?? summary.artifactIndex?.latestToolResults ?? [];
  const latestVectorMatches = summary.runState.latestVectorMatches ?? summary.artifactIndex?.latestVectorMatches ?? [];
  const latestContextRanking = summary.runState.latestContextRanking ?? summary.artifactIndex?.latestContextRanking ?? [];
  const issueCounts = summary.runState.issueCounts ?? summarizeIssueCountsFromIssues(summary.runState.finalIssues ?? []);
  const changedFiles = summary.runState.result?.files?.map((file) => file.path) ?? summary.artifactIndex?.latestFiles ?? [];
  const execution = summary.runState.execution ?? summary.artifactIndex?.execution ?? null;

  console.log("");
  console.log("Latest Run");
  console.log(`- state: ${summary.statePath}`);
  console.log(`- status: ${status}`);
  console.log(`- task: ${summary.runState.task ?? summary.artifactIndex?.latestTask ?? "(unknown)"}`);
  console.log(`- iterations: ${summary.artifactIndex?.iterationCount ?? summary.runState.iterations?.length ?? 0}`);
  if (summary.runState.providers) {
    console.log(
      `- providers: planner=${summary.runState.providers.planner}, reviewer=${summary.runState.providers.reviewer}, generator=${summary.runState.providers.generator}, fixer=${summary.runState.providers.fixer}`
    );
  }
  if (summary.routing.planning || summary.routing.implementation) {
    console.log("- routing:");
    if (summary.routing.planning) {
      console.log(
        `  - planning: profile=${summary.routing.planning.profile}, enabled=${summary.routing.planning.enabled}, reason=${summary.routing.planning.reason}`
      );
    }
    if (summary.routing.implementation) {
      console.log(
        `  - implementation: profile=${summary.routing.implementation.profile}, enabled=${summary.routing.implementation.enabled}, reason=${summary.routing.implementation.reason}`
      );
    }
  }
  console.log(`- changed files: ${changedFiles.join(", ") || "(none)"}`);
  console.log(`- issues: high=${issueCounts.high ?? 0}, medium=${issueCounts.medium ?? 0}, low=${issueCounts.low ?? 0}`);
  if (execution) {
    console.log(`- execution: total=${formatDuration(execution.totalDurationMs)}, cost=${formatCost(execution.budget?.totalCostUnits || 0)}`);
    console.log(`- execution stage: current=${execution.currentStage ?? "none"}, terminal=${execution.terminalStage ?? "none"}`);
    console.log(
      `- failure class: ${execution.failure ? `${execution.failure.class} (${execution.failure.reason})` : "none"}`
    );
    if (execution.budget) {
      console.log(`- run budget: ${formatExecutionBudget(execution.budget)}`);
    }
    if (execution.steps.length > 0) {
      console.log("- step durations:");
      for (const step of execution.steps) {
        console.log(
          `  - ${step.name}: ${step.status} in ${formatDuration(step.durationMs)}${step.detail ? ` - ${step.detail}` : ""}`
        );
      }
    }
    if ((execution.providerMetrics ?? []).length > 0) {
      console.log("- provider metrics:");
      for (const metric of execution.providerMetrics ?? []) {
        console.log(
          `  - ${metric.role}/${metric.provider}: duration=${formatDuration(metric.totalDurationMs)}, cost=${metric.estimatedCostUnits.toFixed(2)}, stages=${metric.stages.join(",")}`
        );
      }
    }
  }
  if (latestToolResults.length > 0) {
    const toolCounts = summarizeToolResults(latestToolResults);
    console.log(`- tool checks: passed=${toolCounts.passed}, failed=${toolCounts.failed}, skipped=${toolCounts.skipped}`);
    for (const tool of latestToolResults) {
      console.log(
        `  - ${tool.name}: ${tool.skipped ? "skipped" : tool.ok ? "passed" : "failed"} (${tool.durationMs}ms)${tool.scope ? ` [scope=${tool.scope}]` : ""}${tool.sandboxMode ? ` [sandbox=${tool.sandboxMode}]` : ""}${tool.workingDirectory ? ` [cwd=${tool.workingDirectory}]` : ""}${tool.command ? ` -> ${tool.command}${tool.args && tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}` : ""}`
      );
    }
  }
  if (latestVectorMatches.length > 0) {
    console.log("- semantic matches:");
    for (const match of latestVectorMatches) {
      console.log(`  - ${match.path}:${match.startLine}-${match.endLine} (score=${match.score.toFixed(3)})`);
    }
  }
  if (latestContextRanking.length > 0) {
    console.log("- ranked context:");
    for (const entry of latestContextRanking.slice(0, 8)) {
      console.log(`  - ${entry.path} (score=${entry.score.toFixed(1)}, sources=${entry.sources.join("+")})`);
    }
  }
  if (summary.runState.latestReviewSummary) {
    console.log(`- last review summary: ${summary.runState.latestReviewSummary}`);
  }
  if (summary.artifactIndex?.applyEventCount) {
    console.log(
      `- apply events: count=${summary.artifactIndex.applyEventCount}, latest=${summary.artifactIndex.latestApplyEventPath ?? "(unknown)"}${summary.artifactIndex.lastAppliedAt ? ` at ${summary.artifactIndex.lastAppliedAt}` : ""}`
    );
  }
  if (summary.artifactIndex?.runPath) {
    console.log(`- artifact run: ${summary.artifactIndex.runPath}`);
  }
}

export function printRunList(runs: RunListEntry[], repoRoot: string): void {
  console.log("");
  console.log("Recent Runs");
  console.log(`- repo: ${repoRoot}`);
  if (runs.length === 0) {
    console.log("- runs: none");
    return;
  }

  for (const run of runs) {
    const execution = run.execution;
    console.log(
      `- ${run.runName}: status=${run.status}, iterations=${run.iterationCount}, updated=${run.updatedAt ?? "(unknown)"}`
    );
    console.log(`  task: ${run.task || "(unknown)"}`);
    console.log(`  state: ${run.statePath}`);
    if (execution) {
      console.log(
        `  execution: total=${formatDuration(execution.totalDurationMs)}, cost=${formatCost(execution.budget?.totalCostUnits || 0)}, failure=${execution.failure ? execution.failure.class : "none"}`
      );
    }
    if (run.applyEventCount) {
      console.log(
        `  apply: count=${run.applyEventCount}, latest=${run.latestApplyEventPath ?? "(unknown)"}${run.lastAppliedAt ? ` at ${run.lastAppliedAt}` : ""}`
      );
    }
    console.log(`  files: ${run.latestFiles.join(", ") || "(none)"}`);
  }
}

export function printArtifactApplyResult(result: ArtifactApplyResult): void {
  console.log("");
  console.log("Artifact Apply");
  console.log(`- repo: ${result.repoRoot}`);
  console.log(`- task: ${result.task || "(unknown)"}`);
  console.log(`- run: ${result.runPath}`);
  console.log(`- iteration: ${result.iterationPath}`);
  console.log(`- manifest: ${result.manifestPath}`);
  console.log(`- dry-run: ${result.dryRun}`);
  console.log(`- force: ${result.force}`);
  console.log(`- wrote files: ${result.wroteFiles}`);
  console.log(`- applied files: ${result.appliedFiles.join(", ") || "(none)"}`);
  console.log(`- issues: high=${result.issueCounts.high}, medium=${result.issueCounts.medium}, low=${result.issueCounts.low}`);
  console.log(`- review summary: ${result.reviewSummary || "no summary"}`);
  console.log(`- apply event: ${result.applyEventPath}`);
}
