import * as workflow from "../../core/config-workflow.js";
import { loadRules } from "../../core/orchestrator-runtime.js";
import { loadRecentRunSummary } from "../../core/artifacts.js";
import { createCliLogger } from "../../utils/logger.js";
import {
  printRoutingExplanation,
  printFailingChecksReviewResult,
  printCurrentChangeReviewResult,
  outputJsonResult
} from "../formatters.js";
import type { CliCommand, TaskRunOptions } from "../types.js";

export async function handleReviewCommand(
  command: CliCommand,
  options: TaskRunOptions & {
    explicitGlobalConfigPath: string | null;
    ignoreProjectConfig: boolean;
    outputJson: boolean;
    savePath: string | null;
  }
): Promise<boolean> {
  const {
    cwd,
    configPath,
    explicitGlobalConfigPath,
    ignoreProjectConfig,
    task
  } = options;

  switch (command.kind) {
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
        return true;
      }

      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summary = await loadRecentRunSummary(cwd, rules, "last");
      printRoutingExplanation({
        source: "latest-run",
        repoRoot: cwd,
        task: summary.runState.task ?? summary.artifactIndex?.latestTask ?? "",
        planning: summary.routing.planning,
        implementation: summary.routing.implementation
      });
      return true;
    }
    default:
      return false;
  }
}

export async function handleReviewWorkflow(options: TaskRunOptions & {
  outputJson: boolean;
  savePath: string | null;
}): Promise<void> {
  const {
    cwd,
    configPath,
    providerPreset,
    reviewFailingChecks,
    reviewStaged,
    reviewBase,
    reviewFiles,
    task,
    outputJson,
    savePath
  } = options;

  const reviewWorkflow = await import("../../core/current-change-review.js");
  const failingWorkflow = await import("../../core/review-failing-checks.js");

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

    const result = await reviewWorkflow.reviewCurrentRepoChanges({
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
  } finally {
    loggerHandle.dispose();
  }
}
