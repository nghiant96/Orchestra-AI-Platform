import fs from "node:fs/promises";
import type { CliCommand } from "../types.js";
import {
  commitSoloJob,
  continueSoloJob,
  explainSoloDiff,
  listSoloJobs,
  readSoloJobLogs,
  showSoloJob,
  undoSoloJob,
  type SoloCommitResult,
  type SoloContinueResult,
  type SoloDiffExplainResult,
  type SoloJobLogsResult,
  type SoloJobShowResult,
  type SoloUndoResult
} from "../../solo/solo-jobs.js";
import type { JobArtifactSummary } from "../../artifacts/artifact-schema.js";
import {
  printSoloDiffExplain,
  printSoloJobList,
  printSoloJobLogs,
  printSoloJobShow,
  printSoloCommitResult,
  printSoloContinueResult,
  printSoloUndoResult
} from "../formatters/solo-jobs.js";

export interface SoloJobsCommandOptions {
  cwd: string;
  outputJson: boolean;
  savePath: string | null;
}

export interface SoloJobsHandlerDependencies {
  list?: typeof listSoloJobs;
  show?: typeof showSoloJob;
  logs?: typeof readSoloJobLogs;
  explain?: typeof explainSoloDiff;
  undo?: typeof undoSoloJob;
  continue?: typeof continueSoloJob;
  commit?: typeof commitSoloJob;
}

export async function handleSoloJobsCommand(
  command: CliCommand,
  options: SoloJobsCommandOptions,
  dependencies: SoloJobsHandlerDependencies = {}
): Promise<boolean> {
  if (command.kind === "solo-job-list") {
    const result = await (dependencies.list ?? listSoloJobs)({ repoRoot: options.cwd });
    await writeOutput(result, options, printSoloJobList);
    return true;
  }
  if (command.kind === "solo-job-show") {
    const result = await (dependencies.show ?? showSoloJob)({ repoRoot: options.cwd, target: command.target });
    await writeOutput(result, options, printSoloJobShow);
    return true;
  }
  if (command.kind === "solo-job-logs") {
    const result = await (dependencies.logs ?? readSoloJobLogs)({ repoRoot: options.cwd, target: command.target });
    await writeOutput(result, options, printSoloJobLogs);
    return true;
  }
  if (command.kind === "solo-diff-explain") {
    const result = await (dependencies.explain ?? explainSoloDiff)({ repoRoot: options.cwd, target: command.target });
    await writeOutput(result, options, printSoloDiffExplain);
    return true;
  }
  if (command.kind === "solo-undo") {
    const result = await (dependencies.undo ?? undoSoloJob)({ repoRoot: options.cwd, target: command.target });
    await writeOutput(result, options, printSoloUndoResult);
    return true;
  }
  if (command.kind === "solo-continue") {
    const result = await (dependencies.continue ?? continueSoloJob)({
      repoRoot: options.cwd,
      target: command.target,
      fixVerification: command.fixVerification,
      providerId: process.env.ORCHESTRA_SOLO_PROVIDER || process.env.ORCHESTRA_WORKER_PROVIDER || "codex",
      providerCommand: process.env.ORCHESTRA_CODEX_COMMAND
    });
    await writeOutput(result, options, printSoloContinueResult);
    return true;
  }
  if (command.kind === "solo-commit") {
    const result = await (dependencies.commit ?? commitSoloJob)({ repoRoot: options.cwd, target: command.target });
    await writeOutput(result, options, printSoloCommitResult);
    return true;
  }
  return false;
}

async function writeOutput<T extends JobArtifactSummary[] | SoloJobShowResult | SoloJobLogsResult | SoloDiffExplainResult | SoloUndoResult | SoloContinueResult | SoloCommitResult>(
  result: T,
  options: SoloJobsCommandOptions,
  printer: (result: T) => void
): Promise<void> {
  if (!options.outputJson) {
    printer(result);
    return;
  }

  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.savePath) {
    await fs.writeFile(options.savePath, output, "utf8");
  }
  process.stdout.write(output);
}
