#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createLogger } from "./utils/logger.js";
import type { OrchestratorResult, RoutingDecision } from "./types.js";
import { maskSecrets } from "./utils/string.js";
import type { ConfigInspection, SetupCheckResult } from "./core/config-workflow.js";
import type { RecentRunSummary, RunListEntry } from "./core/artifacts.js";
import { applyWorkflowModeDefaults, type WorkflowMode } from "./core/workflow-modes.js";

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
  globalConfig: boolean;
  providerPreset: string | null;
  resumeTarget: string | null;
  command: CliCommand | null;
  outputJson: boolean;
  savePath: string | null;
  workflowMode: WorkflowMode;
  force: boolean;
  task: string;
}

type TaskRunOptions = Omit<CliOptions, "chat" | "help" | "command" | "globalConfig" | "outputJson" | "savePath">;
type CliCommand =
  | { kind: "config-show" }
  | { kind: "config-use"; preset: string }
  | { kind: "doctor" }
  | { kind: "explain-routing" }
  | { kind: "setup" }
  | { kind: "setup-check" }
  | { kind: "runs-latest" }
  | { kind: "runs-list" }
  | { kind: "runs-show"; target: string }
  | { kind: "apply-artifact"; target: string };

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

interface CurrentChangeReviewResult {
  repoRoot: string;
  configPath: string | null;
  task: string;
  changedFiles: string[];
  providers: {
    planner: string;
    reviewer: string;
    generator: string;
    fixer: string;
  };
  latestToolResults: import("./types.js").ToolExecutionResult[];
  reviewSummary: string;
  issues: import("./types.js").ReviewIssue[];
  issueCounts: Record<"high" | "medium" | "low", number>;
  execution: import("./types.js").ExecutionSummary;
}

interface ArtifactApplyResult {
  repoRoot: string;
  runPath: string;
  iterationPath: string;
  manifestPath: string;
  task: string;
  dryRun: boolean;
  wroteFiles: boolean;
  appliedFiles: string[];
  reviewSummary: string;
  issueCounts: Record<"high" | "medium" | "low", number>;
  force: boolean;
  applyEventPath: string;
}

type SetupToolName = "lint" | "typecheck" | "build" | "test";

async function main() {
  const options = await parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.command) {
    await runCliCommand(options);
    process.exit(0);
  }

  if (options.chat) {
    await runInteractiveSession(options);
    process.exit(0);
  }

  if (!options.task && !options.resumeTarget) {
    if (options.workflowMode !== "review") {
      printHelp();
      throw new Error("Missing task description.");
    }
  }

  if (options.workflowMode === "review") {
    const reviewResult = await runReviewWorkflow(options);
    if (reviewResult.kind === "task-run") {
      if (options.outputJson) {
        await outputJsonResult(reviewResult.result, options.savePath);
      } else {
        printResult(reviewResult.result);
      }
      process.exit(reviewResult.result.ok ? 0 : 1);
    }
    if (options.outputJson) {
      await outputJsonResult(reviewResult.result, options.savePath);
    } else {
      printCurrentChangeReviewResult(reviewResult.result);
    }
    process.exit(reviewResult.result.issueCounts.high > 0 || reviewResult.result.issueCounts.medium > 0 ? 1 : 0);
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
  let outputJson = false;
  let savePath: string | null = null;
  let help = false;
  let configPath: string | null = null;
  let globalConfig = false;
  let providerPreset: string | null = null;
  let resumeTarget: string | null = null;
  let command: CliCommand | null = null;
  let workflowMode: WorkflowMode = "standard";
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
      workflowMode = "fix";
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
    if (arg === "doctor") {
      command = { kind: "doctor" };
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
    force,
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
  force: _force,
  workflowMode: _workflowMode,
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

async function runReviewWorkflow(options: TaskRunOptions): Promise<
  | { kind: "task-run"; result: OrchestratorResult }
  | { kind: "current-review"; result: CurrentChangeReviewResult }
> {
  const workflow = await import("./core/current-change-review.js");
  const review = await workflow.reviewCurrentRepoChanges({
    repoRoot: options.cwd,
    configPath: options.configPath,
    providerPreset: options.providerPreset,
    task: options.task,
    logger: createLogger()
  });

  if (review) {
    return { kind: "current-review", result: review };
  }

  if (!options.task.trim()) {
    throw new Error("No working tree changes found to review, and no task was provided.");
  }

  return { kind: "task-run", result: await runTask(options) };
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
          workflowMode: "standard",
          force: false,
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

async function runCliCommand({ cwd, configPath, globalConfig, providerPreset, command, task, outputJson, savePath, dryRun, force }: CliOptions): Promise<void> {
  if (!command) {
    return;
  }

  applyProviderPreset(providerPreset);

  const workflow = await import("./core/config-workflow.js");
  const { getDefaultGlobalConfigPath } = await import("./utils/config.js");
  const explicitGlobalConfigPath = globalConfig ? getDefaultGlobalConfigPath() : null;
  const ignoreProjectConfig = globalConfig;

  switch (command.kind) {
    case "config-show": {
      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });
      printConfigShow(inspection);
      return;
    }
    case "config-use": {
      const normalizedPreset = workflow
        .getPresetCatalog()
        .find((preset) => preset.name === command.preset.toLowerCase());
      if (!normalizedPreset) {
        const supported = workflow.getPresetCatalog()
          .map((preset) => preset.name)
          .join(", ");
        throw new Error(`Unsupported preset "${command.preset}". Supported presets: ${supported}.`);
      }

      const result = await workflow.writeProjectPreset({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        preset: normalizedPreset.name
      });
      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: globalConfig ? null : result.configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });
      printConfigUseResult(normalizedPreset.name, result.configPath, inspection);
      return;
    }
    case "doctor": {
      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });
      printDoctor(inspection, workflow.getPresetCatalog());
      return;
    }
    case "explain-routing": {
      if (task.trim()) {
        const inspection = await workflow.inspectProjectConfiguration({
          repoRoot: cwd,
          explicitConfigPath: configPath,
          explicitGlobalConfigPath,
          ignoreProjectConfig,
          task
        });
        printRoutingExplanation({
          source: "current-task",
          repoRoot: cwd,
          task,
          planning: inspection.routing,
          implementation: null
        });
        return;
      }

      const { loadRules } = await import("./core/orchestrator-runtime.js");
      const { loadRecentRunSummary } = await import("./core/artifacts.js");
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summary = await loadRecentRunSummary(cwd, rules, "last");
      printRoutingExplanation({
        source: "latest-run",
        repoRoot: cwd,
        task: summary.runState.task ?? summary.artifactIndex?.latestTask ?? "",
        planning: summary.routing.planning,
        implementation: summary.routing.implementation
      });
      return;
    }
    case "setup": {
      await runSetupWizard({ cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig });
      return;
    }
    case "setup-check": {
      const result = await workflow.runSetupCheck({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });
      printSetupCheck(result);
      return;
    }
    case "runs-latest": {
      const { loadRules } = await import("./core/orchestrator-runtime.js");
      const { loadRecentRunSummary } = await import("./core/artifacts.js");
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summary = await loadRecentRunSummary(cwd, rules, "last");
      if (outputJson) {
        await outputJsonResult(summary, savePath);
        return;
      }
      printRecentRunSummary(summary);
      return;
    }
    case "runs-list": {
      const { loadRules } = await import("./core/orchestrator-runtime.js");
      const { listRecentRunSummaries } = await import("./core/artifacts.js");
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summaries = await listRecentRunSummaries(cwd, rules, 10);
      if (outputJson) {
        await outputJsonResult(summaries, savePath);
        return;
      }
      printRunList(summaries, cwd);
      return;
    }
    case "runs-show": {
      const { loadRules } = await import("./core/orchestrator-runtime.js");
      const { loadRunSummary } = await import("./core/artifacts.js");
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summary = await loadRunSummary(cwd, rules, command.target);
      if (outputJson) {
        await outputJsonResult(summary, savePath);
        return;
      }
      printRecentRunSummary(summary);
      return;
    }
    case "apply-artifact": {
      const workflow = await import("./core/artifact-apply.js");
      const result = await workflow.applyArtifactCandidate({
        repoRoot: cwd,
        configPath,
        target: command.target,
        dryRun,
        force,
        logger: createLogger()
      });
      if (outputJson) {
        await outputJsonResult(result, savePath);
        return;
      }
      printArtifactApplyResult(result);
      return;
    }
  }
}

async function runSetupWizard({
  cwd,
  configPath,
  explicitGlobalConfigPath,
  ignoreProjectConfig
}: {
  cwd: string;
  configPath: string | null;
  explicitGlobalConfigPath: string | null;
  ignoreProjectConfig: boolean;
}): Promise<void> {
  const workflow = await import("./core/config-workflow.js");
  const inspection = await workflow.inspectProjectConfiguration({
    repoRoot: cwd,
    explicitConfigPath: configPath,
    explicitGlobalConfigPath,
    ignoreProjectConfig
  });
  const envValues = await workflow.readEnvValues(cwd);
  const rl = readline.createInterface({ input, output });
  const providerChoices = ["auto", "codex-cli", "gemini-cli", "claude-cli"];

  try {
    console.log("");
    console.log("Setup");
    console.log(`- repo: ${cwd}`);
    console.log(
      `- config: ${explicitGlobalConfigPath ?? inspection.configPath ?? path.join(cwd, ".ai-system.json")}${explicitGlobalConfigPath ? " (global)" : ""}`
    );
    console.log(
      `- current providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
    );
    console.log(`- current routing: ${inspection.effectiveRules.routing?.enabled !== false}`);
    console.log(`- current memory: ${inspection.effectiveRules.memory?.backend ?? "(unset)"}`);

    const plannerProvider = await promptForChoice({
      rl,
      label: "Planner provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "planner"),
      descriptions: providerChoiceDescriptions()
    });

    const reviewerProvider = await promptForChoice({
      rl,
      label: "Reviewer provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "reviewer"),
      descriptions: providerChoiceDescriptions()
    });

    const generatorProvider = await promptForChoice({
      rl,
      label: "Generator provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "generator"),
      descriptions: providerChoiceDescriptions()
    });

    const fixerProvider = await promptForChoice({
      rl,
      label: "Fixer provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "fixer"),
      descriptions: providerChoiceDescriptions()
    });

    const hasAutoRole = [plannerProvider, reviewerProvider, generatorProvider, fixerProvider].includes("auto");

    const routingAnswer = await promptForChoice({
      rl,
      label: "Enable dynamic routing",
      choices: ["yes", "no"],
      defaultValue: hasAutoRole ? "yes" : inspection.effectiveRules.routing?.enabled !== false ? "yes" : "no"
    });
    const routingEnabled = hasAutoRole ? true : routingAnswer === "yes";

    const memoryBackend = await promptForChoice({
      rl,
      label: "Memory backend",
      choices: ["local-file", "openmemory"],
      defaultValue:
        inspection.effectiveRules.memory?.backend === "openmemory" || inspection.effectiveRules.memory?.backend === "local-file"
          ? inspection.effectiveRules.memory.backend
          : "openmemory"
    });

    let openMemoryBaseUrl = envValues.AI_SYSTEM_OPENMEMORY_BASE_URL || "http://127.0.0.1:9080";
    let openMemoryApiKey: string | undefined;

    if (memoryBackend === "openmemory") {
      openMemoryBaseUrl = await promptForInput({
        rl,
        label: "OpenMemory base URL",
        defaultValue: openMemoryBaseUrl
      });

      const apiKeyInput = await promptForInput({
        rl,
        label: "OpenMemory API key",
        defaultValue: envValues.AI_SYSTEM_OPENMEMORY_API_KEY ? "(keep existing)" : "",
        allowEmpty: true
      });
      if (apiKeyInput !== "" && apiKeyInput !== "(keep existing)") {
        openMemoryApiKey = apiKeyInput;
      }
    }

    const toolSelections = {
      lint: await promptForToolSetup(rl, inspection, "lint"),
      typecheck: await promptForToolSetup(rl, inspection, "typecheck"),
      build: await promptForToolSetup(rl, inspection, "build"),
      test: await promptForToolSetup(rl, inspection, "test")
    };

    console.log("");
    console.log("Apply");
    console.log(`- planner: ${plannerProvider}`);
    console.log(`- reviewer: ${reviewerProvider}`);
    console.log(`- generator: ${generatorProvider}`);
    console.log(`- fixer: ${fixerProvider}`);
    console.log(`- dynamic routing: ${routingEnabled}${hasAutoRole && routingAnswer === "no" ? " (forced on because at least one role is auto)" : ""}`);
    console.log(`- memory backend: ${memoryBackend}`);
    if (memoryBackend === "openmemory") {
      console.log(`- OpenMemory base URL: ${openMemoryBaseUrl}`);
      console.log(`- OpenMemory API key: ${openMemoryApiKey ? "(updated)" : envValues.AI_SYSTEM_OPENMEMORY_API_KEY ? "(keep existing)" : "(empty)"}`);
    }
    console.log("- tools:");
    for (const [toolName, selection] of Object.entries(toolSelections)) {
      console.log(
        `  - ${toolName}: mode=${selection.mode}${selection.script ? `, script=${selection.script}` : ""}${selection.appendChangedFiles ? ", changed-files=true" : ""}`
      );
    }

    const confirmation = await promptForInput({
      rl,
      label: "Continue",
      defaultValue: "yes"
    });

    if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) {
      console.log("Setup cancelled.");
      return;
    }

    await workflow.applySetupChoices({
      repoRoot: cwd,
      explicitConfigPath: configPath,
      explicitGlobalConfigPath,
      choices: {
        providers: {
          planner: plannerProvider,
          reviewer: reviewerProvider,
          generator: generatorProvider,
          fixer: fixerProvider
        },
        routingEnabled,
        memoryBackend,
        openMemoryBaseUrl,
        openMemoryApiKey,
        tools: toolSelections
      }
    });

    const result = await workflow.runSetupCheck({
      repoRoot: cwd,
      explicitConfigPath: configPath,
      explicitGlobalConfigPath,
      ignoreProjectConfig
    });

    console.log("");
    console.log("Setup Saved");
    printSetupCheck(result);
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
  ai implement "task description"
  ai review "task description"
  ai fix "task description"
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
  ai fix "Fix the auth flow regression"
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
  Use \`ai review "task"\` for a dry-run review flow with plan approval and a generation checkpoint when there are no current changes.
  Use \`ai fix "task"\` for an interactive fix-focused flow that still writes files when approved.

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

function printConfigShow(inspection: ConfigInspection): void {
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
        `  - ${tool.name}: enabled=${tool.enabled}, source=${tool.source}, scope=${tool.scope ?? "full"}, scoped_changed_files=${tool.scopedToChangedFiles === true}, cwd=${tool.workingDirectory ?? "."}, command=${tool.command ?? "(none)"}${tool.args && tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}`
      );
    }
  }
}

function printConfigUseResult(
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

function printDoctor(
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
  if (inspection.toolSummaries.length > 0) {
    console.log("- effective tool commands:");
    for (const tool of inspection.toolSummaries) {
      console.log(
        `  - ${tool.name}: ${tool.summary} [source=${tool.source}, scope=${tool.scope ?? "full"}, scoped_changed_files=${tool.scopedToChangedFiles === true}]`
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

function printSetupCheck(result: SetupCheckResult): void {
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

function providerChoiceDescriptions(): Record<string, string> {
  return {
    auto: "Let the system decide this role dynamically from the task and routing rules.",
    "codex-cli": "Best fit when you want Codex to own code generation inside this project.",
    "gemini-cli": "Useful for planning or review when you want Gemini CLI in the loop.",
    "claude-cli": "Useful for review or planning when Claude CLI is available on the machine."
  };
}

async function promptForToolSetup(
  rl: readline.Interface,
  inspection: ConfigInspection,
  toolName: SetupToolName
): Promise<{ mode: "auto" | "disabled" | "script"; script?: string; appendChangedFiles?: boolean }> {
  const currentConfig = inspection.projectConfig?.tools?.commands?.[toolName];
  const currentSummary = inspection.toolSummaries.find((entry) => entry.name === toolName);

  const mode = await promptForChoice({
    rl,
    label: `${toolName} check mode`,
    choices: ["auto", "disabled", "script"],
    defaultValue: currentToolMode(currentConfig),
    descriptions: {
      auto: `Use auto-detected project behavior for ${toolName}.`,
      disabled: `Do not run ${toolName} during the generation loop.`,
      script: `Pin ${toolName} to a specific package script.`
    }
  });

  if (mode === "disabled") {
    return { mode };
  }

  let script: string | undefined;
  if (mode === "script") {
    script = await promptForInput({
      rl,
      label: `${toolName} script name`,
      defaultValue: currentToolScriptName(currentConfig, toolName)
    });
  }

  const currentScoped = currentSummary?.scopedToChangedFiles === true || currentConfig?.append_changed_files === true;
  const appendChangedFiles = await promptForChoice({
    rl,
    label: `${toolName} changed-file scoping`,
    choices: ["yes", "no"],
    defaultValue: currentScoped ? "yes" : "no",
    descriptions: {
      yes: `Append changed files to the ${toolName} command when possible.`,
      no: `Run ${toolName} without passing changed file paths.`
    }
  });

  return {
    mode,
    ...(script ? { script } : {}),
    appendChangedFiles: appendChangedFiles === "yes"
  };
}

function currentSetupProviderChoice(
  inspection: ConfigInspection,
  role: "planner" | "reviewer" | "generator" | "fixer"
): string {
  const configuredType = inspection.projectConfig?.providers?.[role]?.type;
  return typeof configuredType === "string" && configuredType.trim() !== "" ? configuredType : "auto";
}

function currentToolMode(currentConfig: unknown): "auto" | "disabled" | "script" {
  if (!currentConfig || typeof currentConfig !== "object" || Array.isArray(currentConfig)) {
    return "auto";
  }

  const candidate = currentConfig as Record<string, unknown>;
  if (candidate.enabled === false) {
    return "disabled";
  }
  if (typeof candidate.script === "string" && candidate.script.trim() !== "") {
    return "script";
  }
  return "auto";
}

function currentToolScriptName(currentConfig: unknown, toolName: SetupToolName): string {
  if (!currentConfig || typeof currentConfig !== "object" || Array.isArray(currentConfig)) {
    return toolName;
  }
  const candidate = currentConfig as Record<string, unknown>;
  return typeof candidate.script === "string" && candidate.script.trim() !== "" ? candidate.script : toolName;
}

async function promptForChoice({
  rl,
  label,
  choices,
  defaultValue,
  descriptions
}: {
  rl: readline.Interface;
  label: string;
  choices: string[];
  defaultValue: string;
  descriptions?: Record<string, string>;
}): Promise<any> {
  console.log("");
  console.log(label);
  for (const choice of choices) {
    console.log(`- ${choice}${descriptions?.[choice] ? `: ${descriptions[choice]}` : ""}`);
  }
  const value = await promptForInput({ rl, label, defaultValue });
  const normalized = value.trim();
  if (!choices.includes(normalized)) {
    throw new Error(`Unsupported ${label.toLowerCase()} "${normalized}". Expected one of: ${choices.join(", ")}.`);
  }
  return normalized;
}

async function promptForInput({
  rl,
  label,
  defaultValue,
  allowEmpty = false
}: {
  rl: readline.Interface;
  label: string;
  defaultValue?: string;
  allowEmpty?: boolean;
}): Promise<string> {
  while (true) {
    const suffix = typeof defaultValue === "string" && defaultValue !== "" ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    if (answer) {
      return answer;
    }
    if (typeof defaultValue === "string") {
      return defaultValue;
    }
    if (allowEmpty) {
      return "";
    }
  }
}

function formatDisplayJson(value: unknown): string {
  return JSON.stringify(sanitizeForDisplay(value), null, 2);
}

function printJson(value: unknown): void {
  console.log(formatDisplayJson(value));
}

async function outputJsonResult(value: unknown, savePath: string | null): Promise<void> {
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
  if (result.execution) {
    console.log(`- execution: total=${formatDuration(result.execution.totalDurationMs)}`);
    console.log(
      `- failure class: ${result.execution.failure ? `${result.execution.failure.class} (${result.execution.failure.reason})` : "none"}`
    );
    if (result.execution.steps.length > 0) {
      console.log("- step durations:");
      for (const step of result.execution.steps) {
        console.log(
          `  - ${step.name}: ${step.status} in ${formatDuration(step.durationMs)}${step.detail ? ` - ${step.detail}` : ""}`
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
        `  - ${tool.name}: ${tool.skipped ? "skipped" : tool.ok ? "passed" : "failed"} (${tool.durationMs}ms)${tool.scope ? ` [scope=${tool.scope}]` : ""}${tool.workingDirectory ? ` [cwd=${tool.workingDirectory}]` : ""}${tool.command ? ` -> ${tool.command}${tool.args && tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}` : ""}`
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

function printRecentRunSummary(summary: RecentRunSummary): void {
  const status = summary.runState.status ?? summary.artifactIndex?.latestStatus ?? "(unknown)";
  const latestToolResults = summary.runState.latestToolResults ?? summary.artifactIndex?.latestToolResults ?? [];
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
    console.log(
      `- failure class: ${execution.failure ? `${execution.failure.class} (${execution.failure.reason})` : "none"}`
    );
    if (execution.steps.length > 0) {
      console.log("- step durations:");
      for (const step of execution.steps) {
        console.log(
          `  - ${step.name}: ${step.status} in ${formatDuration(step.durationMs)}${step.detail ? ` - ${step.detail}` : ""}`
        );
      }
    }
  }
  if (latestToolResults.length > 0) {
    const toolCounts = summarizeToolResults(latestToolResults);
    console.log(`- tool checks: passed=${toolCounts.passed}, failed=${toolCounts.failed}, skipped=${toolCounts.skipped}`);
    for (const tool of latestToolResults) {
      console.log(
        `  - ${tool.name}: ${tool.skipped ? "skipped" : tool.ok ? "passed" : "failed"} (${tool.durationMs}ms)${tool.scope ? ` [scope=${tool.scope}]` : ""}${tool.workingDirectory ? ` [cwd=${tool.workingDirectory}]` : ""}${tool.command ? ` -> ${tool.command}${tool.args && tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}` : ""}`
      );
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

function printCurrentChangeReviewResult(result: CurrentChangeReviewResult): void {
  console.log("");
  console.log("Current Change Review");
  console.log(`- repo: ${result.repoRoot}`);
  console.log(`- config: ${result.configPath ?? "(default rules)"}`);
  console.log(`- task: ${result.task}`);
  console.log(
    `- providers: planner=${result.providers.planner}, reviewer=${result.providers.reviewer}, generator=${result.providers.generator}, fixer=${result.providers.fixer}`
  );
  console.log(`- changed files: ${result.changedFiles.join(", ") || "(none)"}`);
  console.log(`- execution: total=${formatDuration(result.execution.totalDurationMs)}`);
  console.log(
    `- failure class: ${result.execution.failure ? `${result.execution.failure.class} (${result.execution.failure.reason})` : "none"}`
  );
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
  console.log(`- review summary: ${result.reviewSummary || "no summary"}`);
  if (result.issues.length > 0) {
    console.log("- findings:");
    for (const issue of result.issues.slice(0, 10)) {
      console.log(`  - [${issue.severity}] ${issue.path || "(unknown file)"}: ${issue.description}`);
    }
  }
}

function printArtifactApplyResult(result: ArtifactApplyResult): void {
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

function printRunList(runs: RunListEntry[], repoRoot: string): void {
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

function formatDuration(durationMs: number): string {
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

function printRoutingExplanation({
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

function summarizeIssueCountsFromIssues(issues: Array<{ severity: "high" | "medium" | "low" }>): Record<"high" | "medium" | "low", number> {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 }
  );
}

main().catch((error) => {
  const normalized = error as Error;
  console.error(`[error] ${normalized.message}`);
  process.exit(1);
});
