import path from "node:path";
import fs from "node:fs/promises";
import type { OrchestratorResult, RoutingDecision, ExecutionStage } from "../types.js";
import type { ConfigInspection, SetupCheckResult } from "../core/config-workflow.js";
import type { RecentRunSummary, RunListEntry } from "../core/artifacts.js";
import type { FixChecksPreparation } from "../core/fix-checks.js";
import type { FixFromRunPreparation } from "../core/fix-from-run.js";
import type {
  InteractiveState,
  CurrentChangeReviewResult,
  ArtifactApplyResult,
  FailingChecksReviewResult
} from "./types.js";

export function printInteractiveBanner(state: InteractiveState): void {
  console.log("AI Coding System");
  console.log(`- cwd: ${state.cwd}`);
  console.log(`- dry-run: ${state.dryRun}`);
  console.log(`- plan approval: ${state.interactive}`);
  console.log(`- pause after plan: ${state.pauseAfterPlan}`);
  console.log(`- pause after generate: ${state.pauseAfterGenerate}`);
  console.log(`- provider preset: ${state.providerPreset ?? "(default)"}`);
  console.log(`- resume target: ${state.resumeTarget ?? "(none)"}`);
  console.log(`- config: ${state.configPath ?? "(auto .ai-system.json)"}`);
  console.log("Type a task and press Enter. Use /help for session commands.");
}

export function printInteractiveHelp(): void {
  console.log("");
  console.log("Session commands");
  console.log("- /help");
  console.log("- /status");
  console.log("- /dry-run");
  console.log("- /dry-run off");
  console.log("- /interactive");
  console.log("- /interactive off");
  console.log("- /pause-plan");
  console.log("- /pause-plan off");
  console.log("- /pause-generate");
  console.log("- /pause-generate off");
  console.log("- /manual-review");
  console.log("- /manual-review off");
  console.log("- /resume /absolute/or/relative/path/to/run-or-run-state.json");
  console.log("- /resume-last");
  console.log("- /resume clear");
  console.log("- /provider local-cli|9router|openai-compatible|gemini-cli|claude-cli|codex-cli");
  console.log("- /provider clear");
  console.log("- /cwd /absolute/or/relative/path");
  console.log("- /config /absolute/or/relative/path/to/config.json");
  console.log("- /config clear");
  console.log("- /exit");
}

export function printSessionStatus(state: InteractiveState): void {
  console.log("");
  console.log("Session");
  console.log(`- cwd: ${state.cwd}`);
  console.log(`- dry-run: ${state.dryRun}`);
  console.log(`- plan approval: ${state.interactive}`);
  console.log(`- pause after plan: ${state.pauseAfterPlan}`);
  console.log(`- pause after generate: ${state.pauseAfterGenerate}`);
  console.log(`- provider preset: ${state.providerPreset ?? "(default)"}`);
  console.log(`- resume target: ${state.resumeTarget ?? "(none)"}`);
  console.log(`- config: ${state.configPath ?? "(auto .ai-system.json)"}`);
}

export function printHelp(): void {
  console.log(`Usage:
  ai "task description"
  ai implement "task description"
  ai review "task description"
  ai review --staged
  ai review --base main
  ai review --failing-checks
  ai review --files src/auth.ts,src/session.ts
  ai review --staged --files src/auth.ts
  ai review --base main --files src/auth.ts
  ai fix "task description"
  ai fix --from-run last
  ai fix-checks
  ai retry last --stage reviewing
  ai explain-routing "task description"
  ai explain-routing
  ai runs latest
  ai runs list
  ai runs show last
  ai runs show last --json
  ai review --json --save /tmp/review.json
  ai runs show last --json --save /tmp/run.json
  ai apply --from-artifact last
  ai setup
  ai setup --global
  ai setup --check
  ai config show
  ai config show --global
  ai config use codex-all
  ai config use codex-all --global
  ai doctor
  ai doctor --global
  ai --cwd /path/to/repo --dry-run "task description"
  ai --interactive "task description"
  ai --pause-after-plan "task description"
  ai --pause-after-generate "task description"
  ai --manual-review "task description"
  ai --resume /path/to/.ai-system-artifacts/run-.../
  ai --resume-last
  ai --provider 9router "task description"
  ai --9router --chat
  ai --chat

Examples:
  ai "Refactor the auth flow"
  ai implement "Refactor the auth flow"
  ai review "Propose and review auth changes"
  ai review --staged
  ai review --base main
  ai review --failing-checks
  ai review --files src/auth.ts --json --save /tmp/review.json
  ai review --staged --files src/auth.ts --json --save /tmp/staged-scope-review.json
  ai fix "Fix the auth flow regression"
  ai fix --from-run last
  ai fix-checks
  ai retry last --stage reviewing
  ai explain-routing "Refactor the auth flow"
  ai explain-routing
  ai runs latest
  ai runs list
  ai runs show run-2026-...
  ai runs show last --json
  ai review --json --save /tmp/review.json
  ai runs show last --json --save /tmp/run.json
  ai apply --from-artifact last
  ai setup
  ai setup --global
  ai setup --check
  ai config show
  ai config show --global
  ai config use codex-all
  ai config use codex-all --global
  ai doctor
  ai doctor --global
  ai --dry-run "Add a reusable loading state component"
  ai --interactive "Review the plan before changing files"
  ai --pause-after-plan "Pause after planner checkpoint"
  ai --pause-after-generate "Pause before AI review"
  ai --manual-review "Let me inspect every major checkpoint"
  ai --resume-last
  ai --provider 9router --dry-run "Refactor the auth flow"
  ai --cwd /absolute/path/to/repo "Implement retry handling"
  ai --config .ai-system.json --chat
  echo "Fix retry handling in api client" | ai

Interactive mode:
  Run \`ai\` with no task to open a session, similar to Gemini CLI.
  Use --chat explicitly if you want chat mode.
  Use --interactive to confirm the AI plan before changes are generated.
  Use --pause-after-plan to stop after the planner checkpoint.
  Use --pause-after-generate to stop after each generated candidate is saved.
  Use --manual-review to enable plan approval plus both pause checkpoints.
  Use --resume or --resume-last to continue a paused run from checkpoint artifacts.

Workflow modes:
  Use \`ai implement "task"\` for the standard write-enabled flow.
  Use \`ai review\` to review current working tree changes when the repo is dirty.
  Use \`ai review --staged\` to review only what is currently staged in git.
  Use \`ai review --base <git-ref>\` to review the current repo state against a base ref such as \`main\` or \`origin/main\`.
  Use \`ai review --failing-checks\` to review the code regions implicated by the currently failing repo checks.
  Use \`ai review --files <path[,path2...]>\` (or repeat \`--files\`) to review only the requested file scope against \`HEAD\`.
  You can combine \`--files\` with \`--staged\` or \`--base <git-ref>\` to review only a precise subset within that git scope.
  Use \`ai review "task"\` for a dry-run review flow with plan approval and a generation checkpoint when there are no current changes.
  Use \`ai fix "task"\` for an interactive fix-focused flow that still writes files when approved.
  Use \`ai fix-checks\` to run the configured repo checks, turn failing output into a structured repair task, and execute the normal fix loop against it.
  Use \`ai fix --from-run <target>\` to continue from a previous run, resuming directly when possible or building a focused follow-up repair task when not.
  Use \`ai retry <target> --stage <stage>\` to force a retry from a specific state-machine stage such as \`reviewing\`, \`fixing\`, or \`writing\`.

Provider presets:
  --provider local-cli
  --provider 9router
  --provider openai-compatible
  --provider gemini-cli
  --provider claude-cli
  --provider codex-cli
  --9router is a shortcut for --provider 9router

Project config:
  The CLI auto-loads .ai-system.json from the current repo when present.
  The CLI also auto-loads a global config from ~/.config/ai-system/config.json when present.
  You can override it with --config /path/to/config.json
  Use \`ai setup\` for an interactive setup wizard.
  Use \`ai setup --global\` to write global defaults used across repos.
  Use \`ai setup --check\` to validate CLIs and OpenMemory connectivity.
  Use \`ai config use codex-all|hybrid|safe-review\` to set a project preset.
  Add \`--global\` to \`ai config show\`, \`ai config use\`, or \`ai doctor\` to inspect or write the global config layer directly.
  Use \`ai config show\` to inspect the effective config after preset/env merges.
  Use \`ai doctor\` to explain overrides and likely sources of surprising behavior.
  Use \`ai explain-routing "task"\` to see why the current config would choose specific providers.
  Use \`ai explain-routing\` with no task to inspect routing from the latest artifact-backed run.
  Use \`ai runs latest\` to inspect the newest artifact-backed run without opening JSON files manually.
  Use \`ai runs list\` to browse recent runs quickly.
  Use \`ai runs show <target>\` to inspect a specific run directory or run-state file.
  Use \`ai apply --from-artifact <target>\` to apply a saved candidate without rerunning generation.
  Add \`--force\` if you intentionally want to apply a candidate with blocking review issues.
  Add \`--json\` to \`ai runs ...\`, \`ai review\`, or \`ai apply --from-artifact\` when you want machine-readable output.
  Add \`--save /path/to/file.json\` together with \`--json\` when you want the CLI to write the JSON payload directly to disk.

Environment overrides:
  AI_SYSTEM_PROVIDER=local-cli|9router|openai-compatible|gemini-cli|claude-cli|codex-cli
  AI_SYSTEM_MEMORY=local|openmemory|off
  AI_SYSTEM_PLANNER_PROVIDER=gemini-cli|claude-cli|openai-compatible
  AI_SYSTEM_REVIEWER_PROVIDER=gemini-cli|claude-cli|openai-compatible
  AI_SYSTEM_GENERATOR_PROVIDER=codex-cli|claude-cli|openai-compatible
  AI_SYSTEM_FIXER_PROVIDER=codex-cli|claude-cli|openai-compatible
  AI_SYSTEM_GENERATOR_TIMEOUT_MS=0    # disable timeout
  AI_SYSTEM_FIXER_TIMEOUT_MS=0        # disable timeout
  AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS=60000
  AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS=60000
  AI_SYSTEM_GENERATOR_RETRIES=1
  AI_SYSTEM_FIXER_RETRIES=1
  AI_SYSTEM_ROUTING_ENABLED=true|false
  AI_SYSTEM_ROUTING_PROFILE=fast|balanced|safe
  AI_SYSTEM_RISK_PROFILE=low|medium|high
  AI_SYSTEM_MEMORY_ENABLED=true|false
  AI_SYSTEM_MEMORY_BACKEND=local-file|openmemory
  AI_SYSTEM_MEMORY_TRANSPORT=http|cli
  AI_SYSTEM_OPENMEMORY_BASE_URL=http://127.0.0.1:8080
  AI_SYSTEM_BASE_URL=http://127.0.0.1:20128/v1
  AI_SYSTEM_API_KEY=...
  AI_SYSTEM_MODEL=model-from-your-9router-dashboard
  AI_SYSTEM_OPENAI_BASE_URL=http://127.0.0.1:20128/v1
  AI_SYSTEM_OPENAI_API_KEY=...
  AI_SYSTEM_OPENAI_MODEL=model-from-your-9router-dashboard
  AI_SYSTEM_9ROUTER_BASE_URL=http://127.0.0.1:20128/v1
  AI_SYSTEM_9ROUTER_API_KEY=...
  AI_SYSTEM_9ROUTER_MODEL=model-from-your-9router-dashboard
`);
}

export function printConfigShow(inspection: ConfigInspection): void {
  console.log("");
  console.log("Config");
  console.log(`- repo: ${inspection.repoRoot}`);
  console.log(`- global config: ${inspection.globalConfigPath ?? "(none)"}`);
  console.log(`- config: ${inspection.configPath ?? "(none, using internal defaults)"}`);
  console.log(`- global profile: ${inspection.globalProfile ?? "(none)"}`);
  console.log(`- profile: ${inspection.profile ?? "(none)"}`);
  console.log(
    `- effective providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(
    `- routing: enabled=${inspection.effectiveRules.routing?.enabled !== false}, default_profile=${inspection.effectiveRules.routing?.default_profile ?? "(unset)"}, planning_profile=${inspection.routing.profile}`
  );
  console.log(
    `- memory: enabled=${inspection.effectiveRules.memory?.enabled !== false}, backend=${inspection.effectiveRules.memory?.backend ?? "(unset)"}`
  );
  console.log(
    `- vector search: enabled=${inspection.effectiveRules.vector_search?.enabled === true}, data_dir=${inspection.effectiveRules.vector_search?.data_dir ?? "(unset)"}, max_results=${inspection.effectiveRules.vector_search?.max_results ?? "(unset)"}`
  );
  console.log(
    `- tools: enabled=${inspection.effectiveRules.tools?.enabled !== false}, json_validation=${inspection.effectiveRules.tools?.json_validation !== false}`
  );
  console.log(`- env overrides: ${inspection.activeEnvOverrides.length}`);
  if (inspection.projectConfig) {
    console.log("- project config:");
    console.log(formatDisplayJson(inspection.projectConfig));
  }
  if (inspection.toolSummaries.length > 0) {
    console.log("- effective tool commands:");
    for (const tool of inspection.toolSummaries) {
      console.log(
        `  - ${tool.name}: enabled=${tool.enabled}, source=${tool.source}, scope=${tool.scope ?? "full"}, sandbox=${tool.sandboxMode ?? "inherit"}, scoped_changed_files=${tool.scopedToChangedFiles === true}, cwd=${tool.workingDirectory ?? "."}, command=${tool.command ?? "(none)"}${tool.args && tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}`
      );
    }
  }
}

export function printConfigUseResult(
  preset: string,
  configPath: string,
  inspection: ConfigInspection
): void {
  console.log("");
  console.log("Config Updated");
  console.log(`- config: ${configPath}`);
  console.log(`- profile: ${preset}`);
  console.log(
    `- effective providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(`- routing: enabled=${inspection.effectiveRules.routing?.enabled !== false}`);
  console.log("- next step: keep provider/routing behavior in `.ai-system.json`; keep secrets in `.env`.");
}

export function printDoctor(
  inspection: ConfigInspection,
  presets: Array<{ name: string; summary: string }>
): void {
  console.log("");
  console.log("Doctor");
  console.log(`- repo: ${inspection.repoRoot}`);
  console.log(`- global config: ${inspection.globalConfigPath ?? "(none)"}`);
  console.log(`- config: ${inspection.configPath ?? "(none)"}`);
  console.log(`- global profile: ${inspection.globalProfile ?? "(none)"}`);
  console.log(`- profile: ${inspection.profile ?? "(none)"}`);
  console.log(
    `- effective providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(
    `- routing decision: stage=${inspection.routing.stage}, enabled=${inspection.routing.enabled}, profile=${inspection.routing.profile}, reason=${inspection.routing.reason}`
  );
  console.log(
    `- memory: enabled=${inspection.effectiveRules.memory?.enabled !== false}, backend=${inspection.effectiveRules.memory?.backend ?? "(unset)"}`
  );
  console.log(
    `- vector search: enabled=${inspection.effectiveRules.vector_search?.enabled === true}, data_dir=${inspection.effectiveRules.vector_search?.data_dir ?? "(unset)"}, max_results=${inspection.effectiveRules.vector_search?.max_results ?? "(unset)"}`
  );
  console.log(
    `- run budgets: duration=${inspection.effectiveRules.execution?.budgets?.max_duration_ms ?? "(disabled)"}ms, cost=${inspection.effectiveRules.execution?.budgets?.max_cost_units ?? "(disabled)"}`
  );
  if (inspection.toolSummaries.length > 0) {
    console.log("- effective tool commands:");
    for (const tool of inspection.toolSummaries) {
      console.log(
        `  - ${tool.name}: ${tool.summary} [source=${tool.source}, scope=${tool.scope ?? "full"}, sandbox=${tool.sandboxMode ?? "inherit"}, scoped_changed_files=${tool.scopedToChangedFiles === true}]`
      );
    }
  }

  if (inspection.activeEnvOverrides.length > 0) {
    console.log("- active env overrides:");
    for (const entry of inspection.activeEnvOverrides) {
      console.log(`  - ${entry.key}=${entry.value} (${entry.category})`);
    }
  } else {
    console.log("- active env overrides: (none)");
  }

  console.log("- preset catalog:");
  for (const preset of presets) {
    console.log(`  - ${preset.name}: ${preset.summary}`);
  }

  if (inspection.recommendations.length > 0) {
    console.log("- recommendations:");
    for (const recommendation of inspection.recommendations) {
      console.log(`  - ${recommendation}`);
    }
  }
}

export function printSetupCheck(result: SetupCheckResult): void {
  console.log("");
  console.log("Setup Check");
  console.log(`- repo: ${result.inspection.repoRoot}`);
  console.log(`- config: ${result.configPath ?? "(none)"}`);
  console.log(`- env: ${result.envPath}`);
  console.log(`- profile: ${result.inspection.profile ?? "(none)"}`);
  console.log(
    `- effective providers: planner=${result.inspection.effectiveRules.providers.planner.type}, reviewer=${result.inspection.effectiveRules.providers.reviewer.type}, generator=${result.inspection.effectiveRules.providers.generator.type}, fixer=${result.inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(`- codex CLI: ${result.cliAvailability.codex ? "ok" : "missing"}`);
  console.log(`- gemini CLI: ${result.cliAvailability.gemini ? "ok" : "missing"}`);
  console.log(`- claude CLI: ${result.cliAvailability.claude ? "ok" : "missing"}`);

  if (result.openmemory.enabled) {
    console.log(`- OpenMemory base URL: ${result.openmemory.baseUrl ?? "(missing)"}`);
    console.log(`- OpenMemory API key: ${result.openmemory.hasApiKey ? "present" : "missing"}`);
    console.log(`- OpenMemory health: ${formatProbeResult(result.openmemory.health)}`);
    console.log(`- OpenMemory query: ${formatProbeResult(result.openmemory.query)}`);
    console.log(`- OpenMemory add: ${formatProbeResult(result.openmemory.add)}`);
  } else {
    console.log("- OpenMemory: disabled");
  }
}

function formatProbeResult(result: { ok: boolean; status: number | null; message: string }): string {
  const status = result.status === null ? "n/a" : String(result.status);
  return `${result.ok ? "ok" : "failed"} (status=${status}) ${result.message}`;
}

export function formatDisplayJson(value: unknown): string {
  return JSON.stringify(sanitizeForDisplay(value), null, 2);
}

export function printJson(value: unknown): void {
  console.log(formatDisplayJson(value));
}

export async function outputJsonResult(value: unknown, savePath: string | null): Promise<void> {
  const serialized = formatDisplayJson(value);
  if (savePath) {
    const absolutePath = path.resolve(savePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${serialized}\n`, "utf8");
    console.log(`[saved] ${absolutePath}`);
    return;
  }

  console.log(serialized);
}

function sanitizeForDisplay(value: unknown): unknown {
  if (typeof value === "string") {
    return maskSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForDisplay(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [key, sanitizeForDisplay(entryValue)])
    );
  }

  return value;
}

function maskSecrets(value: string): string {
  if (!value) return value;
  // A simple mask for strings that look like keys
  if (value.length > 20 && (value.includes("sk-") || /^[A-Za-z0-9-_]{30,}$/.test(value))) {
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }
  return value;
}

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
    console.log("- next action: inspect the checkpoint artifacts, then rerun when ready.");
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
    console.log(`- execution: total=${formatDuration(execution.totalDurationMs)}`);
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
        `  execution: total=${formatDuration(execution.totalDurationMs)}, failure=${execution.failure ? execution.failure.class : "none"}`
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

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs || 0))}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}

function formatExecutionBudget(budget: {
  totalDurationMs: number;
  totalCostUnits: number;
  maxDurationMs: number | null;
  maxCostUnits: number | null;
  exceeded: "duration" | "cost" | null;
}): string {
  const parts = [
    `duration=${formatDuration(budget.totalDurationMs)}${budget.maxDurationMs ? `/${formatDuration(budget.maxDurationMs)}` : ""}`,
    `cost=${budget.totalCostUnits.toFixed(2)}${budget.maxCostUnits ? `/${budget.maxCostUnits.toFixed(2)}` : ""}`
  ];
  if (budget.exceeded) {
    parts.push(`exceeded=${budget.exceeded}`);
  }
  return parts.join(", ");
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

function printRoutingStage(label: string, decision: RoutingDecision): void {
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

function summarizeToolResults(results: Array<{ ok: boolean; skipped: boolean }>): { passed: number; failed: number; skipped: number } {
  return results.reduce(
    (counts, result) => {
      if (result.skipped) {
        counts.skipped += 1;
      } else if (result.ok) {
        counts.passed += 1;
      } else {
        counts.failed += 1;
      }
      return counts;
    },
    { passed: 0, failed: 0, skipped: 0 }
  );
}

function summarizeIssueCountsFromIssues(issues: Array<{ severity: "high" | "medium" | "low" }>): Record<"high" | "medium" | "low", number> {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 }
  );
}
