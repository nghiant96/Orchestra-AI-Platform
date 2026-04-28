import { createCliLogger } from "../../utils/logger.js";
import * as fixWorkflow from "../../core/fix-checks.js";
import * as fixFromRunWorkflow from "../../core/fix-from-run.js";
import { applyWorkflowModeDefaults } from "../../core/workflow-modes.js";
import {
  printFixChecksPreparation,
  printFixFromRunPreparation,
  printRetryResult,
  printResult,
  outputJsonResult
} from "../formatters.js";
import type { CliCommand, TaskRunOptions, FixChecksCommandResult } from "../types.js";
import { runTask } from "./task-handler.js";

export async function handleFixCommand(
  command: CliCommand,
  options: TaskRunOptions & {
    outputJson: boolean;
    savePath: string | null;
  }
): Promise<boolean> {
  const {
    cwd,
    dryRun,
    interactive,
    pauseAfterPlan,
    pauseAfterGenerate,
    configPath,
    providerPreset,
    retryStage,
    outputJson,
    savePath,
    force
  } = options;

  switch (command.kind) {
    case "fix-checks": {
      const loggerHandle = createCliLogger({ outputJson });
      try {
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
          return true;
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
          return true;
        }
        printFixChecksPreparation(preparation);
        printResult(result);
        return true;
      } finally {
        loggerHandle.dispose();
      }
    }
    case "fix-from-run": {
      const loggerHandle = createCliLogger({ outputJson });
      try {
        const preparation = await fixFromRunWorkflow.prepareFixFromRun({
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
            return true;
          }
          printFixFromRunPreparation(preparation);
          printResult(result);
          return true;
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
          return true;
        }
        printFixFromRunPreparation(preparation);
        printResult(result);
        return true;
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
        return true;
      }
      printRetryResult(command.target, retryStage, result);
      return true;
    }
    default:
      return false;
  }
}
