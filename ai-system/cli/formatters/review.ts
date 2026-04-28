import type { RoutingDecision } from "../../types.js";
import type { CurrentChangeReviewResult, FailingChecksReviewResult } from "../types.js";
import { formatDuration, formatExecutionBudget, summarizeToolResults } from "./shared.js";

export function printCurrentChangeReviewResult(result: CurrentChangeReviewResult): void {
  console.log("");
  console.log("Current Change Review");
  console.log(`- repo: ${result.repoRoot}`);
  console.log(`- config: ${result.configPath ?? "(default rules)"}`);
  console.log(`- task: ${result.task}`);
  const targetParts: string[] = [];
  if (result.targetDetail) {
    targetParts.push(result.targetDetail);
  }
  if (result.targetFiles && result.targetFiles.length > 0) {
    targetParts.push(result.targetFiles.join(", "));
  }
  const targetLabel = `${result.targetMode}${targetParts.length > 0 ? ` (${targetParts.join(" | ")})` : ""}`;
  console.log(`- target: ${targetLabel}`);
  console.log(
    `- providers: planner=${result.providers.planner}, reviewer=${result.providers.reviewer}, generator=${result.providers.generator}, fixer=${result.providers.fixer}`
  );
  console.log(`- changed files: ${result.changedFiles.join(", ") || "(none)"}`);
  console.log(`- execution: total=${formatDuration(result.execution.totalDurationMs)}`);
  console.log(
    `- execution stage: current=${result.execution.currentStage ?? "none"}, terminal=${result.execution.terminalStage ?? "none"}`
  );
  console.log(
    `- failure class: ${result.execution.failure ? `${result.execution.failure.class} (${result.execution.failure.reason})` : "none"}`
  );
  if (result.execution.budget) {
    console.log(`- run budget: ${formatExecutionBudget(result.execution.budget)}`);
  }
  console.log(`- issues: high=${result.issueCounts.high}, medium=${result.issueCounts.medium}, low=${result.issueCounts.low}`);
  if (result.latestToolResults.length > 0) {
    const toolCounts = summarizeToolResults(result.latestToolResults);
    console.log(`- tool checks: passed=${toolCounts.passed}, failed=${toolCounts.failed}, skipped=${toolCounts.skipped}`);
  }
  if (result.execution.steps.length > 0) {
    console.log("- step durations:");
    for (const step of result.execution.steps) {
      console.log(`  - ${step.name}: ${step.status} in ${formatDuration(step.durationMs)}${step.detail ? ` - ${step.detail}` : ""}`);
    }
  }
  if ((result.execution.providerMetrics ?? []).length > 0) {
    console.log("- provider metrics:");
    for (const metric of result.execution.providerMetrics ?? []) {
      console.log(
        `  - ${metric.role}/${metric.provider}: duration=${formatDuration(metric.totalDurationMs)}, cost=${metric.estimatedCostUnits.toFixed(2)}, stages=${metric.stages.join(",")}`
      );
    }
  }
  console.log(`- review summary: ${result.reviewSummary || "no summary"}`);
  if (result.issues.length > 0) {
    console.log("- findings:");
    for (const issue of result.issues.slice(0, 10)) {
      console.log(`  - [${issue.severity}] ${issue.path || "(unknown file)"}: ${issue.description}`);
    }
  }
}

export function printFailingChecksReviewResult(result: FailingChecksReviewResult): void {
  console.log("");
  console.log("Failing Checks Review");
  console.log(`- repo: ${result.repoRoot}`);
  console.log(`- config: ${result.configPath ?? "(default rules)"}`);
  console.log(
    `- providers: planner=${result.providers.planner}, reviewer=${result.providers.reviewer}, generator=${result.providers.generator}, fixer=${result.providers.fixer}`
  );
  console.log(`- file hints: ${result.fileHints.join(", ") || "(none)"}`);
  console.log(`- execution: total=${formatDuration(result.execution.totalDurationMs)}`);
  console.log(`- issues: high=${result.issueCounts.high}, medium=${result.issueCounts.medium}, low=${result.issueCounts.low}`);
  if (result.latestToolResults.length > 0) {
    const toolCounts = summarizeToolResults(result.latestToolResults);
    console.log(`- tool checks: passed=${toolCounts.passed}, failed=${toolCounts.failed}, skipped=${toolCounts.skipped}`);
  }
  console.log(`- review summary: ${result.reviewSummary || "no summary"}`);
  if (result.issues.length > 0) {
    console.log("- findings:");
    for (const issue of result.issues.slice(0, 10)) {
      console.log(`  - [${issue.severity}] ${issue.path || "(unknown file)"}: ${issue.description}`);
    }
  }
}

export function printRoutingExplanation({
  source,
  repoRoot,
  task,
  planning,
  implementation
}: {
  source: "current-task" | "latest-run";
  repoRoot: string;
  task: string;
  planning: RoutingDecision | null;
  implementation: RoutingDecision | null;
}): void {
  console.log("");
  console.log("Routing");
  console.log(`- source: ${source}`);
  console.log(`- repo: ${repoRoot}`);
  console.log(`- task: ${task || "(none)"}`);

  if (!planning && !implementation) {
    console.log("- routing: no routing information available");
    return;
  }

  if (planning) {
    printRoutingStage("planning", planning);
  }
  if (implementation) {
    printRoutingStage("implementation", implementation);
  } else if (source === "current-task") {
    console.log("- implementation:");
    console.log("  - unavailable before the planner produces write targets");
  }
}

export function printRoutingStage(label: string, decision: RoutingDecision): void {
  console.log(`- ${label}:`);
  console.log(`  - enabled: ${decision.enabled}`);
  console.log(`  - profile: ${decision.profile}`);
  console.log(`  - reason: ${decision.reason}`);
  console.log(
    `  - role providers: planner=${decision.roleProviders.planner}, reviewer=${decision.roleProviders.reviewer}, generator=${decision.roleProviders.generator}, fixer=${decision.roleProviders.fixer}`
  );
  if (Object.keys(decision.appliedRoles ?? {}).length > 0) {
    console.log(
      `  - applied roles: ${Object.entries(decision.appliedRoles)
        .map(([role, provider]) => `${role}=${provider}`)
        .join(", ")}`
    );
  }
  const matchedSignals = (decision.signals ?? []).filter((signal) => signal.matched);
  if (matchedSignals.length > 0) {
    console.log("  - matched signals:");
    for (const signal of matchedSignals.slice(0, 10)) {
      console.log(`    - ${signal.name}${signal.details ? `: ${signal.details}` : ""}`);
    }
  }
}
