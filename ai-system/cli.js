#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Orchestrator } from "./core/orchestrator.js";
import { createLogger } from "./utils/logger.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const options = await parseArgs(args);

  if (options.interactive) {
    await runInteractiveSession(options);
    process.exit(0);
  }

  if (!options.task) {
    printHelp();
    throw new Error("Missing task description.");
  }

  const result = await runTask(options);
  printResult(result);
  process.exit(result.ok ? 0 : 1);
}

async function parseArgs(args) {
  let cwd = process.cwd();
  let dryRun = false;
  let interactive = false;
  let configPath = null;
  const taskParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
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
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--chat" || arg === "--interactive") {
      interactive = true;
      continue;
    }
    taskParts.push(arg);
  }

  const pipedTask = await readTaskFromStdin();
  const task = taskParts.join(" ").trim() || pipedTask;

  if (!task && !interactive && process.stdin.isTTY && process.stdout.isTTY) {
    interactive = true;
  }

  return {
    cwd,
    dryRun,
    interactive,
    configPath,
    task
  };
}

async function runTask({ cwd, dryRun, configPath, task }) {
  const logger = createLogger();
  const orchestrator = new Orchestrator({
    repoRoot: cwd,
    logger,
    configPath
  });

  return orchestrator.run(task, { dryRun });
}

async function runInteractiveSession(initialOptions) {
  const state = {
    cwd: initialOptions.cwd,
    dryRun: initialOptions.dryRun,
    configPath: initialOptions.configPath
  };

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
          configPath: state.configPath,
          task: line
        });
        printResult(result);
      } catch (error) {
        console.error(`[error] ${error.message}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function handleInteractiveCommand(line, state) {
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

  return null;
}

function printInteractiveBanner(state) {
  console.log("AI Coding System");
  console.log(`- cwd: ${state.cwd}`);
  console.log(`- dry-run: ${state.dryRun}`);
  console.log(`- config: ${state.configPath ?? "(auto .ai-system.json)"}`);
  console.log("Type a task and press Enter. Use /help for session commands.");
}

function printInteractiveHelp() {
  console.log("");
  console.log("Session commands");
  console.log("- /help");
  console.log("- /status");
  console.log("- /dry-run");
  console.log("- /dry-run off");
  console.log("- /cwd /absolute/or/relative/path");
  console.log("- /config /absolute/or/relative/path/to/config.json");
  console.log("- /config clear");
  console.log("- /exit");
}

function printSessionStatus(state) {
  console.log("");
  console.log("Session");
  console.log(`- cwd: ${state.cwd}`);
  console.log(`- dry-run: ${state.dryRun}`);
  console.log(`- config: ${state.configPath ?? "(auto .ai-system.json)"}`);
}

function buildPrompt(state) {
  return `ai:${path.basename(state.cwd)}${state.dryRun ? " [dry-run]" : ""}> `;
}

function printHelp() {
  console.log(`Usage:
  ai "task description"
  ai --cwd /path/to/repo --dry-run "task description"
  ai --chat

Examples:
  ai "Refactor the auth flow"
  ai --dry-run "Add a reusable loading state component"
  ai --cwd /absolute/path/to/repo "Implement retry handling"
  ai --config .ai-system.json --chat
  echo "Fix retry handling in api client" | ai

Interactive mode:
  Run \`ai\` with no task to open a session, similar to Gemini CLI.
  Use /help inside the session for commands.

Project config:
  The CLI auto-loads .ai-system.json from the current repo when present.
  You can override it with --config /path/to/config.json

Environment overrides:
  AI_SYSTEM_PLANNER_PROVIDER=gemini-cli|claude-cli
  AI_SYSTEM_REVIEWER_PROVIDER=gemini-cli|claude-cli
  AI_SYSTEM_GENERATOR_PROVIDER=codex-cli|claude-cli
  AI_SYSTEM_FIXER_PROVIDER=codex-cli|claude-cli
  AI_SYSTEM_GENERATOR_TIMEOUT_MS=0    # disable timeout
  AI_SYSTEM_FIXER_TIMEOUT_MS=0        # disable timeout
  AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS=60000
  AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS=60000
  AI_SYSTEM_GENERATOR_RETRIES=1
  AI_SYSTEM_FIXER_RETRIES=1
  AI_SYSTEM_MEMORY_ENABLED=true|false
  AI_SYSTEM_MEMORY_BACKEND=local-file|openmemory
  AI_SYSTEM_MEMORY_TRANSPORT=http|cli
  AI_SYSTEM_OPENMEMORY_BASE_URL=http://127.0.0.1:8080
`);
}

async function readTaskFromStdin() {
  if (process.stdin.isTTY) {
    return "";
  }

  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk.toString();
  }

  return data.trim();
}

function printResult(result) {
  const changedFiles = result.result?.files?.map((file) => file.path) ?? [];
  const iterations = result.iterations ?? [];

  console.log("");
  console.log("Result");
  console.log(`- success: ${result.ok}`);
  console.log(`- repo: ${result.repoRoot}`);
  console.log(`- config: ${result.configPath ?? "(default rules)"}`);
  console.log(
    `- providers: planner=${result.providers?.planner}, reviewer=${result.providers?.reviewer}, generator=${result.providers?.generator}, fixer=${result.providers?.fixer}`
  );
  console.log(
    `- memory: backend=${result.memory?.backend}, planning_matches=${result.memory?.planningMatches ?? 0}, implementation_matches=${result.memory?.implementationMatches ?? 0}, stored=${result.memory?.stored}`
  );
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

  if (!result.ok) {
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
  console.error(`[error] ${error.message}`);
  process.exit(1);
});
