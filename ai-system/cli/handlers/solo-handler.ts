import fs from "node:fs/promises";
import type { CliCommand } from "../types.js";
import { runSoloJob, type SoloRunInput, type SoloRunResult } from "../../solo/solo-runner.js";
import { printSoloResult } from "../formatters/solo.js";

export interface SoloCommandOptions {
  cwd: string;
  task: string;
  outputJson: boolean;
  savePath: string | null;
}

export interface SoloHandlerDependencies {
  run?: (input: SoloRunInput) => Promise<SoloRunResult>;
  writeOutput?: (result: SoloRunResult, options: SoloCommandOptions) => void | Promise<void>;
}

export async function handleSoloCommand(
  command: CliCommand,
  options: SoloCommandOptions,
  dependencies: SoloHandlerDependencies = {}
): Promise<boolean> {
  if (command.kind !== "solo-run") return false;

  const result = await (dependencies.run ?? runSoloJob)({
    task: options.task,
    executionMode: command.executionMode,
    repoRoot: options.cwd,
    providerId: process.env.ORCHESTRA_SOLO_PROVIDER || process.env.ORCHESTRA_WORKER_PROVIDER || "codex",
    providerCommand: process.env.ORCHESTRA_CODEX_COMMAND
  });
  await (dependencies.writeOutput ?? writeSoloOutput)(result, options);
  return true;
}

async function writeSoloOutput(result: SoloRunResult, options: SoloCommandOptions): Promise<void> {
  if (!options.outputJson) {
    printSoloResult(result);
    return;
  }

  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.savePath) {
    await fs.writeFile(options.savePath, output, "utf8");
  }
  process.stdout.write(output);
}
