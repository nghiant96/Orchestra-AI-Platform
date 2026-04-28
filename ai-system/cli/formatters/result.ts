import type { OrchestratorResult, ExecutionStage } from "../../types.js";
import type { FixChecksPreparation } from "../../core/fix-checks.js";
import type { FixFromRunPreparation } from "../../core/fix-from-run.js";
import { formatDuration, formatExecutionBudget, summarizeToolResults } from "./shared.js";

export function printResult(result: OrchestratorResult): void {
  const changedFiles = result.result?.files?.map((file) => file.path) ?? [];
  const iterations = result.iterations ?? [];

  console.log("");
  console.log("Result");
  console.log(`- success: ${result.ok}`);
  if (result.status) {
    console.log(`- status: ${result.status}`);
  }
  console.log(`- repo: ${result.repoRoot}`);
  console.log(`- config: ${result.configPath ?? "(default rules)"}`);
  console.log(
    `- providers: planner=${result.providers?.planner}, reviewer=${result.providers?.reviewer}, generator=${result.providers?.generator}, fixer=${result.providers?.fixer}`
  );
  console.log(
    `- memory: backend=${result.memory?.backend}, planning_matches=${result.memory?.planningMatches ?? 0}, implementation_matches=${result.memory?.implementationMatches ?? 0}, stored=${result.memory?.stored}`
  );
  if (result.execution) {
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
    if (result.execution.failure?.class === "iteration-limit") {
      console.log("- budget exceeded: the implementation/review loop hit the configured max_iterations before reaching a green state");
    }
    if (result.execution.steps.length > 0) {
      console.log("- step durations:");
      for (const step of result.execution.steps) {
        console.log(
          `  - ${step.name}: ${step.status} in ${formatDuration(step.durationMs)}${step.detail ? ` - ${step.detail}` : ""}`
        );
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
  }
  if ((result.latestToolResults ?? []).length > 0) {
    const toolCounts = summarizeToolResults(result.latestToolResults ?? []);
    console.log(
      `- tool checks: passed=${toolCounts.passed}, failed=${toolCounts.failed}, skipped=${toolCounts.skipped}`
    );
    console.log("- latest tool results:");
    for (const tool of result.latestToolResults ?? []) {
      console.log(
        `  - ${tool.name}: ${tool.skipped ? "skipped" : tool.ok ? "passed" : "failed"} (${tool.durationMs}ms)${tool.scope ? ` [scope=${tool.scope}]` : ""}${tool.sandboxMode ? ` [sandbox=${tool.sandboxMode}]` : ""}${tool.workingDirectory ? ` [cwd=${tool.workingDirectory}]` : ""}${tool.command ? ` -> ${tool.command}${tool.args && tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}` : ""}`
      );
    }
  }
  console.log(`- artifacts: ${result.artifacts?.latestIterationPath || result.artifacts?.runPath || "(none)"}`);
  if (result.artifacts?.stepPaths && Object.keys(result.artifacts.stepPaths).length > 0) {
    console.log("- checkpoints:");
    for (const [name, artifactPath] of Object.entries(result.artifacts.stepPaths)) {
      console.log(`  - ${name}: ${artifactPath}`);
    }
  }
  console.log(`- planned read files: ${(result.plan?.readFiles ?? []).join(", ") || "(none)"}`);
  console.log(`- skipped context files: ${(result.skippedContextFiles ?? []).join(", ") || "(none)"}`);
  console.log(`- write targets: ${(result.plan?.writeTargets ?? []).join(", ") || "(none)"}`);
  console.log(`- changed files: ${changedFiles.join(", ") || "(none)"}`);
  console.log(`- iterations: ${iterations.length}`);
  console.log(
    `- issues: high=${result.issueCounts?.high ?? 0}, medium=${result.issueCounts?.medium ?? 0}, low=${result.issueCounts?.low ?? 0}`
  );
  console.log(`- wrote files: ${result.wroteFiles}`);

  if (iterations.length > 0) {
    console.log("- loop summaries:");
    for (const iteration of iterations) {
      const toolCounts = summarizeToolResults(iteration.toolResults ?? []);
      const toolSuffix =
        (iteration.toolResults ?? []).length > 0
          ? ` | tools: passed=${toolCounts.passed}, failed=${toolCounts.failed}, skipped=${toolCounts.skipped}`
          : "";
      console.log(`  - #${iteration.iteration}: ${iteration.summary || "no summary"}${toolSuffix}`);
    }
  }

  if (!result.ok && result.status?.startsWith("paused_")) {
    console.log("- next action: inspect or edit checkpoint artifacts, then rerun with --resume/--resume-last when ready.");
  } else if (!result.ok) {
    const blockingIssues = (result.finalIssues ?? []).filter(
      (issue) => issue.severity === "high" || issue.severity === "medium"
    );
    console.log(`- last review summary: ${iterations.at(-1)?.summary || "no summary"}`);
    console.log("- blocking issues:");
    for (const issue of blockingIssues.slice(0, 10)) {
      console.log(`  - [${issue.severity}] ${issue.path || "(unknown file)"}: ${issue.description}`);
    }
  }
}

export function printRetryResult(target: string, stage: ExecutionStage | null, result: OrchestratorResult): void {
  console.log("");
  console.log("Retry");
  console.log(`- target: ${target}`);
  console.log(`- stage override: ${stage ?? "(saved retry hint)"}`);
  printResult(result);
}

export function printFixChecksPreparation(preparation: FixChecksPreparation): void {
  console.log("");
  console.log("Fix Checks");
  console.log(`- repo: ${preparation.repoRoot}`);
  console.log(`- config: ${preparation.configPath ?? "(default rules)"}`);
  console.log(
    `- providers: planner=${preparation.providers.planner}, reviewer=${preparation.providers.reviewer}, generator=${preparation.providers.generator}, fixer=${preparation.providers.fixer}`
  );
  console.log(`- failing checks: ${preparation.failingChecks.map((entry) => entry.name).join(", ") || "(none)"}`);
  console.log(
    `- tool issue counts: high=${preparation.issueCounts.high}, medium=${preparation.issueCounts.medium}, low=${preparation.issueCounts.low}`
  );
  if (preparation.fileHints.length > 0) {
    console.log(`- file hints: ${preparation.fileHints.join(", ")}`);
  }
}

export function printFixFromRunPreparation(preparation: FixFromRunPreparation): void {
  console.log("");
  console.log("Fix From Run");
  console.log(`- repo: ${preparation.repoRoot}`);
  console.log(`- source: ${preparation.target}`);
  console.log(`- resumable: ${preparation.resumable}`);
  if (preparation.resumeTarget) {
    console.log(`- resume target: ${preparation.resumeTarget}`);
  }
  console.log(
    `- previous providers: planner=${preparation.providers.planner}, reviewer=${preparation.providers.reviewer}, generator=${preparation.providers.generator}, fixer=${preparation.providers.fixer}`
  );
  console.log(`- issues: high=${preparation.issueCounts.high}, medium=${preparation.issueCounts.medium}, low=${preparation.issueCounts.low}`);
  if (preparation.fileHints.length > 0) {
    console.log(`- file hints: ${preparation.fileHints.join(", ")}`);
  }
}
