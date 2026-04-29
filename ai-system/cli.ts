import { parseArgs } from "./cli/arg-parser.js";
import { applyProviderPreset, setAllRoleProviders } from "./cli/presets.js";
import {
  printHelp,
  printResult,
  outputJsonResult
} from "./cli/formatters.js";
import type { CliCommand, TaskRunOptions } from "./cli/types.js";
import { handleConfigCommand } from "./cli/handlers/config-handler.js";
import { handleRunsCommand } from "./cli/handlers/runs-handler.js";
import { handleFixCommand } from "./cli/handlers/fix-handler.js";
import { handleReviewCommand, handleReviewWorkflow } from "./cli/handlers/review-handler.js";
import { runTask, runInteractiveSession } from "./cli/handlers/task-handler.js";

async function main(): Promise<void> {
  const options = await parseArgs(process.argv.slice(2));
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
    await handleReviewWorkflow({
      cwd,
      dryRun,
      interactive,
      pauseAfterPlan,
      pauseAfterGenerate,
      configPath,
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
      savePath
    });
    return;
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

async function runCliCommand(
  command: CliCommand,
  options: TaskRunOptions & {
    globalConfig: boolean;
    explicitGlobalConfigPath: string | null;
    ignoreProjectConfig: boolean;
    outputJson: boolean;
    savePath: string | null;
  }
): Promise<void> {
  if (await handleConfigCommand(command, options)) return;
  if (await handleRunsCommand(command, options)) return;
  if (await handleFixCommand(command, options)) return;
  if (await handleReviewCommand(command, options)) return;

  throw new Error(`Unknown command kind: ${(command as any).kind}`);
}

main().catch((error) => {
  const normalized = error as Error;
  console.error(`[error] ${normalized.message}`);
  process.exit(1);
});
