import type {
  ContextFile,
  FileGenerationResult,
  Logger,
  MemoryAdapter,
  MemoryStats,
  PlanResult,
  ReviewIssue
} from "../types.js";
import { readContextFiles } from "./context.js";
import { persistContextArtifacts, type ArtifactState } from "./artifacts.js";
import { safelySearchMemory } from "./run-executor-utils.js";
import type { RuntimeDependencies } from "./run-executor-types.js";

export async function loadImplementationMemoryContext(
  memory: MemoryAdapter,
  task: string,
  plan: PlanResult,
  memoryStats: MemoryStats,
  logger?: Logger
): Promise<string> {
  const implementationMemories = await safelySearchMemory(memory, { task, stage: "implementation", plan }, logger);
  memoryStats.implementationMatches = implementationMemories.length;
  return memory.formatForPrompt(implementationMemories, "implementation");
}

export async function readAndPersistContext(
  repoRoot: string,
  plan: PlanResult,
  rules: import("../types.js").RulesConfig,
  artifactState: ArtifactState,
  logger: Logger
): Promise<{ contextFiles: ContextFile[]; skippedFiles: string[]; durationMs: number }> {
  const startedAt = Date.now();
  logger.step(`Reading ${plan.readFiles.length} file(s) of context`);
  const { contexts: contextFiles, skippedFiles } = await readContextFiles(repoRoot, plan.readFiles, rules, logger);
  const durationMs = Date.now() - startedAt;
  await persistContextArtifacts(
    artifactState,
    {
      readFiles: plan.readFiles,
      skippedFiles,
      contexts: contextFiles,
      durationMs
    },
    logger
  );

  return { contextFiles, skippedFiles, durationMs };
}

export async function generateCandidate({
  iteration,
  task,
  plan,
  currentResult,
  latestReviewSummary,
  acceptedIssues,
  repoRoot,
  implementationMemoryContext,
  contextFiles,
  runtime
}: {
  iteration: number;
  task: string;
  plan: PlanResult;
  currentResult: FileGenerationResult | null;
  latestReviewSummary: string;
  acceptedIssues: ReviewIssue[];
  repoRoot: string;
  implementationMemoryContext: string;
  contextFiles: ContextFile[];
  runtime: RuntimeDependencies;
}): Promise<FileGenerationResult> {
  if (iteration === 1 && !currentResult) {
    return runtime.generator.generateCode(task, plan, contextFiles, repoRoot, implementationMemoryContext);
  }

  if (!currentResult) {
    throw new Error("Missing generation result before fixer iteration.");
  }

  return runtime.fixer.fixCode(
    task,
    plan,
    currentResult.files,
    latestReviewSummary,
    acceptedIssues,
    repoRoot,
    implementationMemoryContext
  );
}
