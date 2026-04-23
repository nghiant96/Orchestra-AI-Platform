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
  let workflowMode: WorkflowMode = "standard";
  let retryStage: ExecutionStage | null = null;
  let reviewStaged = false;
  let reviewBase: string | null = null;
  let reviewFailingChecks = false;
  const reviewFiles: string[] = [];
  let force = false;
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

    taskParts.push(arg);
  }

  const pipedTask = command ? "" : await readTaskFromStdin();
  const task = taskParts.join(" ").trim() || pipedTask;
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
