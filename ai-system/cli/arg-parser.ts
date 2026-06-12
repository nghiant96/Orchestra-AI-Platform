import path from "node:path";
import type { ExecutionStage } from "../types.js";
import { applyWorkflowModeDefaults, type WorkflowMode } from "../core/workflow-modes.js";
import type { CliCommand, CliOptions } from "./types.js";

export async function parseArgs(args: string[]): Promise<CliOptions> {
  let cwd = process.cwd();
  let dryRun = false;
  let chat = false;
  let confirmPlan = false;
  let pauseAfterPlan = false;
  let pauseAfterGenerate = false;
  let outputJson = false;
  let savePath: string | null = null;
  let help = false;
  let configPath: string | null = null;
  let globalConfig = false;
  let providerPreset: string | null = null;
  let resumeTarget: string | null = null;
  let command: CliCommand | null = null;
  let soloCommandName: "run" | "quick" | "safe" | null = null;
  let workerCommandActive = false;
  let workflowMode: WorkflowMode = "standard";
  let retryStage: ExecutionStage | null = null;
  let reviewStaged = false;
  let reviewBase: string | null = null;
  let reviewFailingChecks = false;
  const reviewFiles: string[] = [];
  let force = false;
  let allowDirtyWorkingTree = false;
  let dirtyTreeMode: "allow" | "stash" | "worktree" | undefined;
  let dryRunExplicit = false;
  let interactiveExplicit = false;
  let pauseAfterPlanExplicit = false;
  let pauseAfterGenerateExplicit = false;
  const taskParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }
    if (arg === "apply") {
      const nextArg = args[index + 1];
      if (nextArg !== "--from-artifact") {
        throw new Error("Unsupported apply usage. Use `ai apply --from-artifact <target>`.");
      }
      const target = args[index + 2];
      if (!target) {
        throw new Error("Missing target for `apply --from-artifact`. Use a run directory, iteration directory, manifest path, or `last`.");
      }
      command = { kind: "apply-artifact", target };
      index += 2;
      continue;
    }
    if (arg === "run" || arg === "quick" || arg === "safe") {
      if (command) {
        throw new Error(`Cannot combine \`ai ${arg}\` with another command.`);
      }
      soloCommandName = arg;
      command = {
        kind: "solo-run",
        executionMode: arg === "run" ? "normal" : arg
      };
      continue;
    }
    if (arg === "job") {
      const subCommand = args[index + 1];
      if (subCommand === "list") {
        command = { kind: "solo-job-list" };
        index += 1;
        continue;
      }
      if (subCommand === "show" || subCommand === "logs") {
        const target = args[index + 2];
        if (!target) {
          throw new Error(`Missing target for \`ai job ${subCommand} <job-id|last>\`.`);
        }
        command = subCommand === "show"
          ? { kind: "solo-job-show", target }
          : { kind: "solo-job-logs", target };
        index += 2;
        continue;
      }
      throw new Error("Unsupported job subcommand. Use `job list`, `job show <job-id|last>`, or `job logs <job-id|last>`.");
    }
    if (arg === "undo") {
      const target = args[index + 1];
      if (!target) {
        throw new Error("Missing target for `ai undo <job-id|last>`.");
      }
      command = { kind: "solo-undo", target };
      index += 1;
      continue;
    }
    if (arg === "continue") {
      let target = "last";
      let fixVerification = false;
      let consumed = 0;
      while (index + consumed + 1 < args.length) {
        const nextArg = args[index + consumed + 1];
        if (nextArg === "--job") {
          const jobId = args[index + consumed + 2];
          if (!jobId || jobId.startsWith("-")) {
            throw new Error("Missing job id for `ai continue --job <job-id>`.");
          }
          target = jobId;
          consumed += 2;
          continue;
        }
        if (nextArg === "--fix-verification") {
          fixVerification = true;
          consumed += 1;
          continue;
        }
        break;
      }
      command = { kind: "solo-continue", target, fixVerification };
      index += consumed;
      continue;
    }
    if (arg === "commit") {
      const target = args[index + 1];
      if (!target || target.startsWith("-")) {
        throw new Error("Missing target for `ai commit <job-id|last>`.");
      }
      command = { kind: "solo-commit", target };
      index += 1;
      continue;
    }
    if (arg === "diff") {
      const subCommand = args[index + 1];
      if (subCommand !== "explain") {
        throw new Error("Unsupported diff command. Use `diff explain [job-id|last]`.");
      }
      const target = args[index + 2] && !args[index + 2]?.startsWith("-") ? args[index + 2] : "last";
      command = { kind: "solo-diff-explain", target };
      index += target === "last" ? 1 : 2;
      continue;
    }
    if (arg === "implement") {
      workflowMode = "implement";
      continue;
    }
    if (arg === "review") {
      workflowMode = "review";
      continue;
    }
    if (arg === "fix") {
      if (args[index + 1] === "--from-run") {
        const target = args[index + 2];
        if (!target) {
          throw new Error("Missing target for `ai fix --from-run <target>`.");
        }
        command = { kind: "fix-from-run", target };
        workflowMode = "fix";
        index += 2;
        continue;
      }
      workflowMode = "fix";
      continue;
    }
    if (arg === "retry") {
      const target = args[index + 1];
      if (!target || target.startsWith("-")) {
        throw new Error("Missing target for `ai retry <target>`.");
      }
      command = { kind: "retry", target };
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--save") {
      const targetPath = args[index + 1];
      if (!targetPath) {
        throw new Error("Missing path for `--save`.");
      }
      savePath = targetPath;
      index += 1;
      continue;
    }
    if (arg === "--files") {
      const nextArg = args[index + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        throw new Error("Missing path list for `--files`. Use a comma-separated list or repeat `--files <path>`.");
      }
      const parsedPaths = nextArg
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (parsedPaths.length === 0) {
        throw new Error("Missing path list for `--files`. Use a comma-separated list or repeat `--files <path>`.");
      }
      reviewFiles.push(...parsedPaths);
      index += 1;
      continue;
    }
    if (arg === "--failing-checks") {
      reviewFailingChecks = true;
      continue;
    }
    if (arg === "doctor") {
      command = { kind: "doctor" };
      continue;
    }
    if (arg === "fix-checks") {
      command = { kind: "fix-checks" };
      continue;
    }
    if (arg === "explain-routing") {
      command = { kind: "explain-routing" };
      continue;
    }
    if (arg === "runs") {
      const nextArg = args[index + 1];
      if (nextArg === "latest") {
        command = { kind: "runs-latest" };
        index += 1;
        continue;
      }
      if (nextArg === "list") {
        command = { kind: "runs-list" };
        index += 1;
        continue;
      }
      if (nextArg === "show") {
        const target = args[index + 2];
        if (!target) {
          throw new Error("Missing target for `runs show`. Use a run directory, run-state path, or `last`.");
        }
        command = { kind: "runs-show", target };
        index += 2;
        continue;
      }
      throw new Error("Unsupported runs subcommand. Use `runs latest`, `runs list`, or `runs show <target>`.");
    }
    if (arg === "setup") {
      const nextArg = args[index + 1];
      if (nextArg === "--check") {
        command = { kind: "setup-check" };
        index += 1;
      } else {
        command = { kind: "setup" };
      }
      continue;
    }
    if (arg === "config") {
      const action = args[index + 1];
      if (!action) {
        throw new Error("Missing subcommand for config. Use `config show` or `config use <preset>`.");
      }
      if (action === "show") {
        command = { kind: "config-show" };
        index += 1;
        continue;
      }
      if (action === "use") {
        const preset = args[index + 2];
        if (!preset) {
          throw new Error("Missing preset for `config use`. Example: `ai config use codex-all`.");
        }
        command = { kind: "config-use", preset };
        index += 2;
        continue;
      }
      throw new Error(`Unsupported config subcommand "${action}". Use \`config show\` or \`config use <preset>\`.`);
    }
    if (arg === "work") {
      const subCommand = args[index + 1];
      if (subCommand === "create") {
        const title = args[index + 2];
        if (!title) {
          throw new Error("Missing title for `ai work create <title>`.");
        }
        command = { kind: "work-create", title };
        index += 2;
        continue;
      }
      if (subCommand === "list") {
        command = { kind: "work-list" };
        index += 1;
        continue;
      }
      if (subCommand === "show") {
        const target = args[index + 2];
        if (!target) {
          throw new Error("Missing ID for `ai work show <id>`.");
        }
        command = { kind: "work-show", target };
        index += 2;
        continue;
      }
      if (subCommand === "branch") {
        const target = args[index + 2];
        if (!target) {
          throw new Error("Missing ID for `ai work branch <id>`.");
        }
        command = { kind: "work-branch", target };
        index += 2;
        continue;
      }
      if (subCommand === "worktree") {
        const next = args[index + 2];
        const target = args[index + 3];
        if (next !== "create" || !target) {
          if (next === "remove" && target) {
            command = { kind: "work-worktree-remove", target };
            index += 3;
            continue;
          }
          throw new Error("Use `ai work worktree create <id>` or `ai work worktree remove <id>`.");
        }
        command = { kind: "work-worktree-create", target };
        index += 3;
        continue;
      }
      if (subCommand === "commit") {
        const target = args[index + 2];
        if (!target) {
          throw new Error("Missing ID for `ai work commit <id>`.");
        }
        const push = args.includes("--push");
        command = { kind: "work-commit", target, push };
        index += 2;
        continue;
      }
      if (subCommand === "pr") {
        const target = args[index + 2];
        if (!target) {
          throw new Error("Missing ID for `ai work pr <id>`.");
        }
        const draft = !args.includes("--no-draft");
        const dryRunPr = args.includes("--dry-run-pr");
        command = { kind: "work-pr", target, draft, dryRunPr };
        index += 2;
        continue;
      }
      if (subCommand === "from-issue") {
        const url = args[index + 2];
        if (!url) throw new Error("Missing URL for `ai work from-issue <url>`.");
        command = { kind: "work-from-issue", url };
        index += 2;
        continue;
      }
      if (subCommand === "from-pr") {
        const url = args[index + 2];
        if (!url) throw new Error("Missing URL for `ai work from-pr <url>`.");
        command = { kind: "work-from-pr", url };
        index += 2;
        continue;
      }
      if (subCommand === "inbox") {
        if (args[index + 2] !== "sync") throw new Error("Use `ai work inbox sync`.");
        command = { kind: "work-inbox-sync" };
        index += 2;
        continue;
      }
      if (subCommand === "ci") {
        const next = args[index + 2];
        const target = args[index + 3];
        if (next === "watch" && target) {
          command = { kind: "work-ci-watch", target };
          index += 3;
          continue;
        }
        if (next === "fix" && target) {
          command = { kind: "work-ci-fix", target };
          index += 3;
          continue;
        }
        throw new Error("Use `ai work ci watch <id>` or `ai work ci fix <id>`.");
      }
      if (subCommand === "schedule") {
        command = { kind: "work-schedule" };
        index += 1;
        continue;
      }
      if (subCommand === "metrics") {
        command = { kind: "work-metrics" };
        index += 1;
        continue;
      }
      throw new Error(`Unsupported work command "${subCommand}". Use \`work create\`, \`work list\`, \`work show <id>\`, \`work branch <id>\`, \`work worktree create <id>\`, \`work worktree remove <id>\`, \`work commit <id>\`, or \`work pr <id>\`.`);
    }
    if (arg === "worker") {
      const subCommand = args[index + 1];
      if (subCommand !== "start") {
        throw new Error("Unsupported worker command. Use `worker start`.");
      }
      command = { kind: "worker-start" };
      workerCommandActive = true;
      index += 1;
      continue;
    }
    if (workerCommandActive && arg.startsWith("--")) {
      if (arg === "--server-url") {
        const nextArg = args[index + 1];
        if (!nextArg) throw new Error("Missing value for `--server-url`.");
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), serverUrl: nextArg };
        index += 1;
        continue;
      }
      if (arg === "--token") {
        const nextArg = args[index + 1];
        if (!nextArg) throw new Error("Missing value for `--token`.");
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), workerToken: nextArg };
        index += 1;
        continue;
      }
      if (arg === "--name") {
        const nextArg = args[index + 1];
        if (!nextArg) throw new Error("Missing value for `--name`.");
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), workerName: nextArg };
        index += 1;
        continue;
      }
      if (arg === "--labels") {
        const nextArg = args[index + 1];
        if (!nextArg) throw new Error("Missing value for `--labels`.");
        const workerLabels = nextArg.split(",").map((value) => value.trim()).filter(Boolean);
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), workerLabels };
        index += 1;
        continue;
      }
      if (arg === "--workspace-roots") {
        const nextArg = args[index + 1];
        if (!nextArg) throw new Error("Missing value for `--workspace-roots`.");
        const workspaceRoots = nextArg.split(",").map((value) => value.trim()).filter(Boolean);
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), workspaceRoots };
        index += 1;
        continue;
      }
      if (arg === "--heartbeat-interval") {
        const nextArg = args[index + 1];
        if (!nextArg) throw new Error("Missing value for `--heartbeat-interval`.");
        const heartbeatIntervalMs = Number(nextArg);
        if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
          throw new Error("`--heartbeat-interval` must be a positive number.");
        }
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), heartbeatIntervalMs };
        index += 1;
        continue;
      }
      if (arg === "--poll-interval") {
        const nextArg = args[index + 1];
        if (!nextArg) throw new Error("Missing value for `--poll-interval`.");
        const pollIntervalMs = Number(nextArg);
        if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
          throw new Error("`--poll-interval` must be a positive number.");
        }
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), pollIntervalMs };
        index += 1;
        continue;
      }
      if (arg === "--once") {
        command = { ...(command as Extract<CliCommand, { kind: "worker-start" }>), once: true };
        continue;
      }
      throw new Error(`Unsupported worker flag "${arg}".`);
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
    if (arg === "--global") {
      globalConfig = true;
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
      dryRunExplicit = true;
      continue;
    }
    if (arg === "--chat") {
      chat = true;
      continue;
    }
    if (arg === "--interactive" || arg === "--approve-plan") {
      confirmPlan = true;
      interactiveExplicit = true;
      continue;
    }
    if (arg === "--pause-after-plan") {
      pauseAfterPlan = true;
      pauseAfterPlanExplicit = true;
      continue;
    }
    if (arg === "--pause-after-generate") {
      pauseAfterGenerate = true;
      pauseAfterGenerateExplicit = true;
      continue;
    }
    if (arg === "--manual-review") {
      confirmPlan = true;
      pauseAfterPlan = true;
      pauseAfterGenerate = true;
      interactiveExplicit = true;
      pauseAfterPlanExplicit = true;
      pauseAfterGenerateExplicit = true;
      continue;
    }
    if (arg === "--json") {
      outputJson = true;
      continue;
    }
    if (arg === "--stage") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for `--stage`.");
      }
      retryStage = normalizeRetryStage(nextArg);
      index += 1;
      continue;
    }
    if (arg === "--staged") {
      reviewStaged = true;
      continue;
    }
    if (arg === "--base") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for `--base`.");
      }
      reviewBase = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--allow-dirty") {
      allowDirtyWorkingTree = true;
      dirtyTreeMode = "allow";
      continue;
    }
    if (arg === "--stash") {
      dirtyTreeMode = "stash";
      allowDirtyWorkingTree = true;
      continue;
    }
    if (arg === "--worktree") {
      dirtyTreeMode = "worktree";
      allowDirtyWorkingTree = true;
      continue;
    }

    if (workerCommandActive) {
      throw new Error("Worker start does not accept positional arguments.");
    }

    taskParts.push(arg);
  }

  const pipedTask = command ? "" : await readTaskFromStdin();
  const task = taskParts.join(" ").trim() || pipedTask;
  if (soloCommandName && !task) {
    throw new Error(`Missing task for \`ai ${soloCommandName}\`.`);
  }
  if (savePath && !outputJson) {
    throw new Error("`--save` requires `--json`.");
  }
  if (retryStage && command?.kind !== "retry") {
    throw new Error("`--stage` is only supported with `ai retry <target>`.");
  }
  const workflowFlags = applyWorkflowModeDefaults(workflowMode, {
    dryRun: dryRunExplicit ? dryRun : undefined,
    interactive: interactiveExplicit ? confirmPlan : undefined,
    pauseAfterPlan: pauseAfterPlanExplicit ? pauseAfterPlan : undefined,
    pauseAfterGenerate: pauseAfterGenerateExplicit ? pauseAfterGenerate : undefined
  });

  if (!task && !chat && process.stdin.isTTY && process.stdout.isTTY && workflowMode === "standard") {
    chat = true;
  }

  return {
    cwd,
    dryRun: workflowFlags.dryRun,
    chat,
    interactive: workflowFlags.interactive,
    pauseAfterPlan: workflowFlags.pauseAfterPlan,
    pauseAfterGenerate: workflowFlags.pauseAfterGenerate,
    help,
    configPath,
    globalConfig,
    providerPreset,
    resumeTarget,
    command,
    outputJson,
    savePath,
    workflowMode,
    retryStage,
    reviewStaged,
    reviewBase,
    reviewFailingChecks,
    reviewFiles,
    force,
    allowDirtyWorkingTree,
    dirtyTreeMode,
    task
  };
}

export function normalizeRetryStage(value: string): ExecutionStage {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "context":
    case "context-loading":
      return "context";
    case "generating":
    case "generate":
    case "generation":
      return "iteration-generate";
    case "checking":
    case "check":
    case "tools":
    case "tooling":
      return "iteration-tools";
    case "reviewing":
    case "review":
      return "iteration-review";
    case "fixing":
    case "fix":
      return "iteration-fix";
    case "writing":
    case "write":
      return "write-files";
    case "memory":
    case "store-memory":
      return "memory-store";
    default:
      throw new Error(
        "Unsupported retry stage. Use one of: context, generating, checking, reviewing, fixing, writing, memory."
      );
  }
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
