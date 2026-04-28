import { loadRules } from "../../core/orchestrator-runtime.js";
import { loadRecentRunSummary, listRecentRunSummaries, loadRunSummary } from "../../core/artifacts.js";
import * as applyWorkflow from "../../core/artifact-apply.js";
import { createCliLogger } from "../../utils/logger.js";
import {
  printRecentRunSummary,
  printRunList,
  printArtifactApplyResult,
  outputJsonResult
} from "../formatters.js";
import type { CliCommand, TaskRunOptions } from "../types.js";

export async function handleRunsCommand(
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
    outputJson,
    savePath,
    dryRun,
    force
  } = options;

  switch (command.kind) {
    case "runs-latest": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summary = await loadRecentRunSummary(cwd, rules, "last");
      if (outputJson) {
        await outputJsonResult(summary, savePath);
        return true;
      }
      printRecentRunSummary(summary);
      return true;
    }
    case "runs-list": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summaries = await listRecentRunSummaries(cwd, rules, 10);
      if (outputJson) {
        await outputJsonResult(summaries, savePath);
        return true;
      }
      printRunList(summaries, cwd);
      return true;
    }
    case "runs-show": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const summary = await loadRunSummary(cwd, rules, command.target);
      if (outputJson) {
        await outputJsonResult(summary, savePath);
        return true;
      }
      printRecentRunSummary(summary);
      return true;
    }
    case "apply-artifact": {
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
          return true;
        }
        printArtifactApplyResult(result);
        return true;
      } finally {
        loggerHandle.dispose();
      }
    }
    default:
      return false;
  }
}
