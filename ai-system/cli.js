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

  const { cwd, dryRun, task } = await parseArgs(args);
  if (!task) {
    printHelp();
    throw new Error("Missing task description.");
  }

  const logger = createLogger();
  const orchestrator = new Orchestrator({
    repoRoot: cwd,
    logger
  });

  const result = await orchestrator.run(task, { dryRun });
  printResult(result);
  process.exit(result.ok ? 0 : 1);
}

async function parseArgs(args) {
  let cwd = process.cwd();
  let dryRun = false;
  const taskParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cwd") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --cwd.");
      }
      cwd = path.resolve(nextArg);
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    taskParts.push(arg);
  }

  const task = taskParts.join(" ").trim() || (await readTaskFromStdin()) || (await promptForTask());

  return {
    cwd,
    dryRun,
    task
  };
}

function printHelp() {
  console.log(`Usage:
  node ai-system/cli.js "task description"
  node ai-system/cli.js --cwd /path/to/repo --dry-run "task description"

Examples:
  pnpm run ai -- "Refactor the auth flow"
  pnpm run ai -- --dry-run "Add a reusable loading state component"
  echo "Fix retry handling in api client" | pnpm run ai

Environment overrides:
  AI_SYSTEM_PLANNER_PROVIDER=gemini-cli|claude-cli
  AI_SYSTEM_REVIEWER_PROVIDER=gemini-cli|claude-cli
  AI_SYSTEM_GENERATOR_PROVIDER=codex-cli|claude-cli
  AI_SYSTEM_FIXER_PROVIDER=codex-cli|claude-cli
  AI_SYSTEM_MEMORY_ENABLED=true|false
  AI_SYSTEM_MEMORY_BACKEND=local-file|openmemory
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

async function promptForTask() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "";
  }

  const rl = readline.createInterface({ input, output });
  try {
    const task = await rl.question("Task: ");
    return task.trim();
  } finally {
    rl.close();
  }
}

function printResult(result) {
  const changedFiles = result.result?.files?.map((file) => file.path) ?? [];
  const iterations = result.iterations ?? [];

  console.log("");
  console.log("Result");
  console.log(`- success: ${result.ok}`);
  console.log(`- repo: ${result.repoRoot}`);
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
