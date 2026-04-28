import readline from "node:readline";
import { parseArgs } from "./cli/arg-parser.js";
import { applyProviderPreset, setAllRoleProviders } from "./cli/presets.js";
import { handleInteractiveCommand, buildPrompt } from "./cli/interactive.js";
import { runSetupWizard } from "./cli/setup.js";
import { createCliLogger } from "./utils/logger.js";
import type { OrchestratorResult } from "./types.js";
import {
  printHelp,
  printInteractiveBanner,
  printDoctor,
  printConfigShow,
  printConfigUseResult,
  printSetupCheck,
  printResult,
  printRecentRunSummary,
  printRunList,
  printCurrentChangeReviewResult,
  printArtifactApplyResult,
  printRetryResult,
  printFixChecksPreparation,
  printFailingChecksReviewResult,
  printFixFromRunPreparation,
  printRoutingExplanation,
  outputJsonResult
} from "./cli/formatters.js";
import type { FixChecksCommandResult, TaskRunOptions } from "./cli/types.js";
import { applyWorkflowModeDefaults } from "./core/workflow-modes.js";

async function main(): Promise<void> {
  const options = await parseArgs(process.argv);
  const {
    cwd,
    dryRun,
    chat,
    interactive,
    pauseAfterPlan,
    pauseAfterGenerate,
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
  } = options;

  if (help) {
    printHelp();
    return;
  }

  const explicitGlobalConfigPath = globalConfig ? process.env.AI_SYSTEM_GLOBAL_CONFIG_PATH || null : null;
  const ignoreProjectConfig = globalConfig;

  if (providerPreset) {
    applyProviderPreset(providerPreset);
  }

  if (command) {
    await runCliCommand(command, {
      cwd,
      dryRun,
      interactive,
      pauseAfterPlan,
      pauseAfterGenerate,
      configPath,
      globalConfig,
      providerPreset,
      resumeTarget,
      workflowMode,
      retryStage,
      reviewStaged,
      reviewBase,
      reviewFailingChecks,
      reviewFiles,
      force,
      task,
      outputJson,
      explicitGlobalConfigPath,
      ignoreProjectConfig,
      savePath
    });
    return;
  }

  if (workflowMode === "review") {
    const workflow = await import("./core/current-change-review.js");
    const failingWorkflow = await import("./core/review-failing-checks.js");

    const reviewTarget = reviewFailingChecks
      ? "failing-checks"
      : reviewStaged
        ? "staged"
        : reviewBase
          ? "base-ref"
          : reviewFiles.length > 0
            ? "files"
            : task
              ? "task"
              : "working-tree";

    const loggerHandle = createCliLogger({ outputJson });
    try {
      if (reviewTarget === "failing-checks") {
        const result = await failingWorkflow.reviewFailingChecks({
          repoRoot: cwd,
          configPath,
          providerPreset,
          logger: loggerHandle.logger
        });

        if (!result) {
          console.log("No failing checks to review.");
          return;
        }

        if (outputJson) {
          await outputJsonResult(result, savePath);
          return;
        }

        printFailingChecksReviewResult(result);
        return;
      }

      const result = await workflow.reviewCurrentRepoChanges({
        repoRoot: cwd,
        configPath,
        providerPreset,
        task,
        targetMode: reviewTarget === "task" ? "working-tree" : reviewTarget,
        targetDetail: reviewBase,
        targetFiles: reviewFiles,
        logger: loggerHandle.logger
      });

      if (!result) {
        console.log("No current changes to review.");
        return;
      }

      if (outputJson) {
        await outputJsonResult(result, savePath);
        return;
      }

      printCurrentChangeReviewResult(result);
      return;
    } finally {
      loggerHandle.dispose();
    }
  }

  if (task) {
    const result = await runTask({
      cwd,
      dryRun,
      interactive,
      pauseAfterPlan,
      pauseAfterGenerate,
      configPath,
      providerPreset,
      resumeTarget,
      retryStage,
      workflowMode,
      outputJson,
      reviewStaged,
      reviewBase,
      reviewFailingChecks,
      reviewFiles,
      force,
      task
    });
    if (outputJson) {
      await outputJsonResult(result, savePath);
    } else {
      printResult(result);
    }
    return;
  }

  if (chat) {
    setAllRoleProviders("9router");
  }

  await runInteractiveSession({
    cwd,
    dryRun,
    interactive,
    pauseAfterPlan,
    pauseAfterGenerate,
    configPath,
    providerPreset,
    resumeTarget
  });
}

async function runInteractiveSession(initialState: {
  cwd: string;
  dryRun: boolean;
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  configPath: string | null;
  providerPreset: string | null;
  resumeTarget: string | null;
}): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const state = { ...initialState };

  printInteractiveBanner(state);

  const ask = () => {
    rl.question(buildPrompt(state), async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        ask();
        return;
      }

      try {
        const cmdResult = await handleInteractiveCommand(trimmed, state);
        if (cmdResult === "exit") {
          rl.close();
          return;
        }
        if (cmdResult === "handled") {
          ask();
          return;
        }

        const taskResult = await runTask({
          cwd: state.cwd,
          dryRun: state.dryRun,
          interactive: state.interactive,
          pauseAfterPlan: state.pauseAfterPlan,
          pauseAfterGenerate: state.pauseAfterGenerate,
          configPath: state.configPath,
          providerPreset: state.providerPreset,
          resumeTarget: state.resumeTarget,
          retryStage: null,
          workflowMode: "standard",
          outputJson: false,
          reviewStaged: false,
          reviewBase: null,
          reviewFailingChecks: false,
          reviewFiles: [],
          force: false,
          task: trimmed
        });

        printResult(taskResult);

        if (state.resumeTarget) {
          state.resumeTarget = null;
        }
      } catch (error) {
        const normalized = error as Error;
        console.error(`[error] ${normalized.message}`);
      }
      ask();
    });
  };

  ask();

  return new Promise((resolve) => {
    rl.on("close", () => {
      console.log("");
      resolve();
    });
  });
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
  retryStage,
  outputJson = false,
  task
}: TaskRunOptions & { outputJson?: boolean }): Promise<OrchestratorResult> {
  applyProviderPreset(providerPreset);

  const { Orchestrator } = await import("./core/orchestrator.js");
  const loggerHandle = createCliLogger({ outputJson });
  const orchestrator = new Orchestrator({
    repoRoot: cwd,
    logger: loggerHandle.logger,
    configPath
  });
  try {
    if (resumeTarget) {
      return (await orchestrator.resume(resumeTarget, { stage: retryStage })) as OrchestratorResult;
    }

    return (await orchestrator.run(task, {
      dryRun,
      interactive,
      pauseAfterPlan,
      pauseAfterGenerate
    })) as OrchestratorResult;
  } finally {
    loggerHandle.dispose();
  }
}

async function runCliCommand(
  command: import("./cli/types.js").CliCommand,
  options: TaskRunOptions & {
    globalConfig: boolean;
    explicitGlobalConfigPath: string | null;
    ignoreProjectConfig: boolean;
    outputJson: boolean;
    savePath: string | null;
  }
): Promise<void> {
  const {
    cwd,
    dryRun,
    interactive,
    pauseAfterPlan,
    pauseAfterGenerate,
    configPath,
    globalConfig,
    providerPreset,
    explicitGlobalConfigPath,
    ignoreProjectConfig,
    retryStage,
    outputJson,
    savePath,
    force,
    task
  } = options;

  const workflow = await import("./core/config-workflow.js");

  switch (command.kind) {
    case "doctor": {
      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig,
        task: "ping"
      });
      const presets = workflow.getPresetCatalog();

      if (outputJson) {
        await outputJsonResult({ inspection, presets }, savePath);
        return;
      }
      printDoctor(inspection, presets);
      return;
    }
    case "config-show": {
      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });
      if (outputJson) {
        await outputJsonResult(inspection, savePath);
        return;
      }
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
      const targetConfigPath = result.configPath;

      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: globalConfig ? null : result.configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });

      if (outputJson) {
        await outputJsonResult({ preset: command.preset, configPath: targetConfigPath, inspection }, savePath);
        return;
      }
      printConfigUseResult(command.preset, targetConfigPath, inspection);
      return;
    }
    case "fix-checks": {
      const loggerHandle = createCliLogger({ outputJson });
      try {
        const fixWorkflow = await import("./core/fix-checks.js");
        const preparation = await fixWorkflow.prepareFixChecksTask({
          repoRoot: cwd,
          configPath,
          providerPreset,
          logger: loggerHandle.logger
        });

        if (!preparation || preparation.failingChecks.length === 0) {
          const payload = {
            ok: true,
            repoRoot: cwd,
            summary: "No failing repository checks detected.",
            latestToolResults: []
          };
          if (outputJson) {
            await outputJsonResult(payload, savePath);
          } else {
            console.log("");
            console.log("Fix Checks");
            console.log(`- repo: ${cwd}`);
            console.log("- status: no failing repository checks detected");
          }
          return;
        }

        const fixFlags = applyWorkflowModeDefaults("fix", {
          dryRun,
          interactive,
          pauseAfterPlan,
          pauseAfterGenerate
        });
        const result = await runTask({
          cwd,
          dryRun: fixFlags.dryRun,
          interactive: fixFlags.interactive,
          pauseAfterPlan: fixFlags.pauseAfterPlan,
          pauseAfterGenerate: fixFlags.pauseAfterGenerate,
          configPath,
          providerPreset,
          resumeTarget: null,
          retryStage: null,
          workflowMode: "fix",
          outputJson,
          reviewStaged: false,
          reviewBase: null,
          reviewFailingChecks: false,
          reviewFiles: [],
          force,
          task: preparation.task
        });
        if (outputJson) {
          await outputJsonResult({ preparation, result } satisfies FixChecksCommandResult, savePath);
          return;
        }
        printFixChecksPreparation(preparation);
        printResult(result);
        return;
      } finally {
        loggerHandle.dispose();
      }
    }
    case "fix-from-run": {
      const loggerHandle = createCliLogger({ outputJson });
      try {
        const fixWorkflow = await import("./core/fix-from-run.js");
        const preparation = await fixWorkflow.prepareFixFromRun({
          repoRoot: cwd,
          configPath,
          target: command.target,
          logger: loggerHandle.logger
        });

        if (preparation.resumable && preparation.resumeTarget) {
          const result = await runTask({
            cwd,
            dryRun,
            interactive,
            pauseAfterPlan,
            pauseAfterGenerate,
            configPath,
            providerPreset,
            resumeTarget: preparation.resumeTarget,
            retryStage: null,
            workflowMode: "fix",
            outputJson,
            reviewStaged: false,
            reviewBase: null,
            reviewFailingChecks: false,
            reviewFiles: [],
            force,
            task: ""
          });
          if (outputJson) {
            await outputJsonResult({ preparation, result }, savePath);
            return;
          }
          printFixFromRunPreparation(preparation);
          printResult(result);
          return;
        }

        const fixFlags = applyWorkflowModeDefaults("fix", {
          dryRun,
          interactive,
          pauseAfterPlan,
          pauseAfterGenerate
        });
        const result = await runTask({
          cwd,
          dryRun: fixFlags.dryRun,
          interactive: fixFlags.interactive,
          pauseAfterPlan: fixFlags.pauseAfterPlan,
          pauseAfterGenerate: fixFlags.pauseAfterGenerate,
          configPath,
          providerPreset,
          resumeTarget: null,
          retryStage: null,
          workflowMode: "fix",
          outputJson,
          reviewStaged: false,
          reviewBase: null,
          reviewFailingChecks: false,
          reviewFiles: [],
          force,
          task: preparation.task
        });
        if (outputJson) {
          await outputJsonResult({ preparation, result }, savePath);
          return;
        }
        printFixFromRunPreparation(preparation);
        printResult(result);
        return;
      } finally {
        loggerHandle.dispose();
      }
    }
    case "retry": {
      const result = await runTask({
        cwd,
        dryRun,
        interactive,
        pauseAfterPlan,
        pauseAfterGenerate,
        configPath,
        providerPreset,
        resumeTarget: command.target,
        retryStage,
        workflowMode: "fix",
        outputJson,
        reviewStaged: false,
        reviewBase: null,
        reviewFailingChecks: false,
        reviewFiles: [],
        force,
        task: ""
      });
      if (outputJson) {
        await outputJsonResult({ target: command.target, stage: retryStage, result }, savePath);
        return;
      }
      printRetryResult(command.target, retryStage, result);
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
      const applyWorkflow = await import("./core/artifact-apply.js");
      const loggerHandle = createCliLogger({ outputJson });
      try {
        const result = await applyWorkflow.applyArtifactCandidate({
          repoRoot: cwd,
          configPath,
          target: command.target,
          dryRun,
          force,
          logger: loggerHandle.logger
        });
        if (outputJson) {
          await outputJsonResult(result, savePath);
          return;
        }
        printArtifactApplyResult(result);
        return;
      } finally {
        loggerHandle.dispose();
      }
    }
  }
}

main().catch((error) => {
  const normalized = error as Error;
  console.error(`[error] ${normalized.message}`);
  process.exit(1);
});
