import fs from "node:fs/promises";
import path from "node:path";
import type { CliCommand } from "../types.js";
import { runSoloJob, type SoloRunInput, type SoloRunResult } from "../../solo/solo-runner.js";
import { printSoloResult } from "../formatters/solo.js";
import { prepareDirtyTreeExecution, type DirtyTreeMode } from "../../solo/solo-dirty-tree.js";

export interface SoloCommandOptions {
  cwd: string;
  task: string;
  outputJson: boolean;
  savePath: string | null;
  allowDirtyWorkingTree?: boolean;
  dirtyTreeMode?: "allow" | "stash" | "worktree";
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

  const dirtyTreeMode = resolveDirtyTreeMode(options);
  let prepared: Awaited<ReturnType<typeof prepareDirtyTreeExecution>> | null = null;
  let executionRoot = options.cwd;

  if (dirtyTreeMode === "stash" || dirtyTreeMode === "worktree") {
    prepared = await prepareDirtyTreeExecution({
      repoRoot: options.cwd,
      jobId: createSoloJobSeed(options.task),
      mode: dirtyTreeMode
    });
    executionRoot = prepared.executionRoot;
  }

  let result: SoloRunResult;
  try {
    result = await (dependencies.run ?? runSoloJob)({
      task: options.task,
      executionMode: command.executionMode,
      repoRoot: executionRoot,
      artifactRootDir: executionRoot === options.cwd ? undefined : path.join(options.cwd, ".orchestra", "jobs"),
      allowDirtyWorkingTree: options.allowDirtyWorkingTree ?? false,
      providerId: process.env.ORCHESTRA_SOLO_PROVIDER || process.env.ORCHESTRA_WORKER_PROVIDER || "codex",
      providerCommand: process.env.ORCHESTRA_CODEX_COMMAND
    });
  } finally {
    if (prepared) {
      await prepared.cleanup();
    }
  }

  const finalResult = dirtyTreeMode === "worktree" && executionRoot !== options.cwd
    ? { ...result, summary: `${result.summary} (worktree: ${executionRoot})` }
    : result;

  await (dependencies.writeOutput ?? writeSoloOutput)(finalResult, options);
  return true;
}

function resolveDirtyTreeMode(options: SoloCommandOptions): DirtyTreeMode | null {
  if (options.dirtyTreeMode) return options.dirtyTreeMode;
  if (options.allowDirtyWorkingTree) return "allow";
  return null;
}

function createSoloJobSeed(task: string): string {
  return `${task}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "job";
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
