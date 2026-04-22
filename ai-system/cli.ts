#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createLogger } from "./utils/logger.js";
import type { OrchestratorResult } from "./types.js";

const PRESET_ENV_KEYS = [
  "AI_SYSTEM_PROVIDER",
  "AI_SYSTEM_PLANNER_PROVIDER",
  "AI_SYSTEM_REVIEWER_PROVIDER",
  "AI_SYSTEM_GENERATOR_PROVIDER",
  "AI_SYSTEM_FIXER_PROVIDER",
  "AI_SYSTEM_BASE_URL",
  "AI_SYSTEM_API_KEY",
  "AI_SYSTEM_MODEL",
  "AI_SYSTEM_OPENAI_BASE_URL",
  "AI_SYSTEM_OPENAI_API_KEY",
  "AI_SYSTEM_OPENAI_MODEL"
];
const PRESET_ENV_BASELINE = new Map(PRESET_ENV_KEYS.map((key) => [key, process.env[key]]));

interface CliOptions {
  cwd: string;
  dryRun: boolean;
  chat: boolean;
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  help: boolean;
  configPath: string | null;
  providerPreset: string | null;
  resumeTarget: string | null;
  task: string;
}

type TaskRunOptions = Omit<CliOptions, "chat" | "help">;

interface InteractiveState {
  cwd: string;
  dryRun: boolean;
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  configPath: string | null;
  providerPreset: string | null;
  resumeTarget: string | null;
}

async function main() {
  const options = await parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.chat) {
    await runInteractiveSession(options);
    process.exit(0);
  }

  if (!options.task && !options.resumeTarget) {
    printHelp();
    throw new Error("Missing task description.");
  }

  const result = await runTask(options);
  printResult(result);
  process.exit(result.ok ? 0 : 1);
}

async function parseArgs(args: string[]): Promise<CliOptions> {
  let cwd = process.cwd();
  let dryRun = false;
  let chat = false;
  let confirmPlan = false;
  let pauseAfterPlan = false;
  let pauseAfterGenerate = false;
  let help = false;
  let configPath: string | null = null;
  let providerPreset: string | null = null;
  let resumeTarget: string | null = null;
  const taskParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--cwd") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --cwd.");
      }
      cwd = path.resolve(nextArg);
      index += 1;
      continue;
    }
    if (arg === "--config") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --config.");
      }
      configPath = path.resolve(nextArg);
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --provider.");
      }
      providerPreset = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--resume") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --resume.");
      }
      resumeTarget = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--resume-last") {
      resumeTarget = "last";
      continue;
    }
    if (arg === "--9router") {
      providerPreset = "9router";
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--chat") {
      chat = true;
      continue;
    }
    if (arg === "--interactive" || arg === "--approve-plan") {
      confirmPlan = true;
      continue;
    }
    if (arg === "--pause-after-plan") {
      pauseAfterPlan = true;
      continue;
    }
    if (arg === "--pause-after-generate") {
      pauseAfterGenerate = true;
      continue;
    }
    if (arg === "--manual-review") {
      confirmPlan = true;
      pauseAfterPlan = true;
      pauseAfterGenerate = true;
      continue;
    }

    taskParts.push(arg);
  }

  const pipedTask = await readTaskFromStdin();
  const task = taskParts.join(" ").trim() || pipedTask;

  if (!task && !chat && process.stdin.isTTY && process.stdout.isTTY) {
    chat = true;
  }

  return {
    cwd,
    dryRun,
    chat,
    interactive: confirmPlan,
    pauseAfterPlan,
    pauseAfterGenerate,
    help,
    configPath,
    providerPreset,
    resumeTarget,
    task
  };
}

async function runTask({
  cwd,
  dryRun,
  interactive,
  pauseAfterPlan,
  pauseAfterGenerate,
  configPath,
  providerPreset,
  resumeTarget,
  task
}: TaskRunOptions): Promise<OrchestratorResult> {
  applyProviderPreset(providerPreset);

  const { Orchestrator } = await import("./core/orchestrator.js");
  const logger = createLogger();
  const orchestrator = new Orchestrator({
    repoRoot: cwd,
    logger,
    configPath
  });

  if (resumeTarget) {
    return (await orchestrator.resume(resumeTarget)) as OrchestratorResult;
  }

  return (await orchestrator.run(task, { dryRun, interactive, pauseAfterPlan, pauseAfterGenerate })) as OrchestratorResult;
}

async function runInteractiveSession(initialOptions: CliOptions): Promise<void> {
  const state: InteractiveState = {
    cwd: initialOptions.cwd,
    dryRun: initialOptions.dryRun,
    interactive: initialOptions.interactive,
    pauseAfterPlan: initialOptions.pauseAfterPlan,
    pauseAfterGenerate: initialOptions.pauseAfterGenerate,
    configPath: initialOptions.configPath,
    providerPreset: initialOptions.providerPreset,
    resumeTarget: initialOptions.resumeTarget
  };

  applyProviderPreset(state.providerPreset);

  const rl = readline.createInterface({ input, output });
  printInteractiveBanner(state);

  try {
    while (true) {
      const raw = await rl.question(buildPrompt(state));
      const line = raw.trim();

      if (!line) {
        continue;
      }

      const commandResult = await handleInteractiveCommand(line, state);
      if (commandResult === "exit") {
        break;
      }
      if (commandResult === "handled") {
        continue;
      }

      try {
        const result = await runTask({
          cwd: state.cwd,
          dryRun: state.dryRun,
          interactive: state.interactive,
          pauseAfterPlan: state.pauseAfterPlan,
          pauseAfterGenerate: state.pauseAfterGenerate,
          configPath: state.configPath,
          providerPreset: state.providerPreset,
          resumeTarget: state.resumeTarget,
          task: line
        });
        printResult(result);
      } catch (error) {
        const normalized = error as Error;
        console.error(`[error] ${normalized.message}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function handleInteractiveCommand(line: string, state: InteractiveState): Promise<"exit" | "handled" | null> {
  if (line === "exit" || line === "quit" || line === "/exit" || line === "/quit") {
    return "exit";
  }

  if (line === "/help") {
    printInteractiveHelp();
    return "handled";
  }

  if (line === "/status") {
    printSessionStatus(state);
    return "handled";
  }

  if (line === "/dry-run" || line === "/dry-run on") {
    state.dryRun = true;
    console.log("[info] dry-run enabled");
    return "handled";
  }

  if (line === "/dry-run off") {
    state.dryRun = false;
    console.log("[info] dry-run disabled");
    return "handled";
  }

  if (line === "/interactive" || line === "/interactive on") {
    state.interactive = true;
    console.log("[info] plan approval enabled");
    return "handled";
  }

  if (line === "/interactive off") {
    state.interactive = false;
    console.log("[info] plan approval disabled");
    return "handled";
  }

  if (line === "/pause-plan" || line === "/pause-plan on") {
    state.pauseAfterPlan = true;
    console.log("[info] pause-after-plan enabled");
    return "handled";
  }

  if (line === "/pause-plan off") {
    state.pauseAfterPlan = false;
    console.log("[info] pause-after-plan disabled");
    return "handled";
  }

  if (line === "/pause-generate" || line === "/pause-generate on") {
    state.pauseAfterGenerate = true;
    console.log("[info] pause-after-generate enabled");
    return "handled";
  }

  if (line === "/pause-generate off") {
    state.pauseAfterGenerate = false;
    console.log("[info] pause-after-generate disabled");
    return "handled";
  }

  if (line === "/manual-review" || line === "/manual-review on") {
    state.interactive = true;
    state.pauseAfterPlan = true;
    state.pauseAfterGenerate = true;
    console.log("[info] manual-review mode enabled");
    return "handled";
  }

  if (line === "/manual-review off") {
    state.pauseAfterPlan = false;
    state.pauseAfterGenerate = false;
    console.log("[info] manual-review mode disabled");
    return "handled";
  }

  if (line.startsWith("/cwd ")) {
    state.cwd = path.resolve(line.slice(5).trim());
    console.log(`[info] cwd set to ${state.cwd}`);
    return "handled";
  }

  if (line === "/config clear") {
    state.configPath = null;
    console.log("[info] config override cleared");
    return "handled";
  }

  if (line.startsWith("/config ")) {
    const value = line.slice(8).trim();
    state.configPath = value ? path.resolve(value) : null;
    console.log(`[info] config set to ${state.configPath ?? "(auto)"}`);
    return "handled";
  }

  if (line === "/provider clear") {
    state.providerPreset = null;
    console.log("[info] provider preset cleared");
    return "handled";
  }

  if (line.startsWith("/provider ")) {
    const value = line.slice(10).trim();
    state.providerPreset = value || null;
    applyProviderPreset(state.providerPreset);
    console.log(`[info] provider preset set to ${state.providerPreset ?? "(default)"}`);
    return "handled";
  }

  if (line === "/resume-last") {
    state.resumeTarget = "last";
    console.log("[info] resume target set to last");
    return "handled";
  }

  if (line.startsWith("/resume ")) {
    const value = line.slice(8).trim();
    state.resumeTarget = value || null;
    console.log(`[info] resume target set to ${state.resumeTarget ?? "(none)"}`);
    return "handled";
  }

  if (line === "/resume clear") {
    state.resumeTarget = null;
    console.log("[info] resume target cleared");
    return "handled";
  }

  return null;
}

function applyProviderPreset(preset: string | null): void {
  resetPresetEnv();

  if (!preset) {
    return;
  }

  const normalized = String(preset).trim().toLowerCase();
  if (!normalized || normalized === "default") {
    return;
  }

  if (normalized === "local" || normalized === "local-cli") {
    setManagedEnv("AI_SYSTEM_PROVIDER", "local-cli");
    return;
  }

  if (normalized === "9router") {
    setManagedEnv("AI_SYSTEM_PROVIDER", "9router");
    return;
  }

  if (["openai-compatible", "gemini-cli", "claude-cli", "codex-cli"].includes(normalized)) {
    setManagedEnv("AI_SYSTEM_PROVIDER", normalized);
    return;
  }

  throw new Error(`Unsupported provider preset "${preset}".`);
}

function setAllRoleProviders(providerType: string): void {
  setManagedEnv("AI_SYSTEM_PLANNER_PROVIDER", providerType);
  setManagedEnv("AI_SYSTEM_REVIEWER_PROVIDER", providerType);
  setManagedEnv("AI_SYSTEM_GENERATOR_PROVIDER", providerType);
  setManagedEnv("AI_SYSTEM_FIXER_PROVIDER", providerType);
}

function resetPresetEnv(): void {
  for (const key of PRESET_ENV_KEYS) {
    const baseline = PRESET_ENV_BASELINE.get(key);
    if (typeof baseline === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = baseline;
    }
  }
}

function setManagedEnv(key: string, value: string): void {
  process.env[key] = value;
}

function printInteractiveBanner(state: InteractiveState): void {
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

function printInteractiveHelp(): void {
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

function printSessionStatus(state: InteractiveState): void {
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

function buildPrompt(state: InteractiveState): string {
  const mode = [
    state.dryRun ? "dry-run" : null,
    state.interactive ? "confirm-plan" : null,
    state.pauseAfterPlan ? "pause-plan" : null,
    state.pauseAfterGenerate ? "pause-generate" : null,
    state.providerPreset ? state.providerPreset : null
  ]
    .filter(Boolean)
    .join(",");
  return `ai:${path.basename(state.cwd)}${mode ? ` [${mode}]` : ""}> `;
}

function printHelp(): void {
  console.log(`Usage:
  ai "task description"
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
  You can override it with --config /path/to/config.json

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

async function readTaskFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk.toString();
  }

  return data.trim();
}

function printResult(result: OrchestratorResult): void {
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
      console.log(`  - #${iteration.iteration}: ${iteration.summary || "no summary"}`);
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

main().catch((error) => {
  const normalized = error as Error;
  console.error(`[error] ${normalized.message}`);
  process.exit(1);
});
