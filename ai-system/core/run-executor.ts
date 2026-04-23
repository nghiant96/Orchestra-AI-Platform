import path from "node:path";
import { PlannerAgent } from "../agents/planner.js";
import { GeneratorAgent } from "../agents/generator.js";
import { FixerAgent } from "../agents/fixer.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { createProvider } from "../providers/registry.js";
import { createMemoryAdapter } from "../memory/registry.js";
import type {
  ContextFile,
  ExecutionSummary,
  FileGenerationResult,
  GeneratedFile,
  IterationResult,
  JsonProvider,
  Logger,
  MemoryAdapter,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  ProviderSummary,
  ReviewIssue,
  RunStatus,
  RulesConfig
} from "../types.js";
import { createDryRunToolExecutionSummary, runToolChecks } from "./tool-executor.js";
import {
  readContextFiles,
  readOriginalFiles,
  resolveRepoPath,
  writeFilesAtomically
} from "./context.js";
import {
  buildDiffSummaries,
  hasBlockingIssues,
  mergeIssues,
  normalizeReviewResult,
  summarizeIssueCounts,
  validateCandidateFiles
} from "./reviewer.js";
import {
  buildStoppedResult,
  finalizeArtifactState,
  persistContextArtifacts,
  persistExecutionTransition,
  persistIterationArtifacts,
  persistRunState,
  type ArtifactState
} from "./artifacts.js";
import { buildExecutionSummary } from "./execution-summary.js";
import { ExecutionStateMachine } from "./execution-state-machine.js";

export interface RuntimeDependencies {
  plannerProvider: JsonProvider;
  reviewerProvider: JsonProvider;
  generatorProvider: JsonProvider;
  fixerProvider: JsonProvider;
  planner: PlannerAgent;
  reviewer: ReviewerAgent;
  generator: GeneratorAgent;
  fixer: FixerAgent;
  memory: MemoryAdapter;
  providerSummary: ProviderSummary;
}

export interface LoopExecutionState {
  currentResult: FileGenerationResult | null;
  acceptedIssues: ReviewIssue[];
  latestReviewSummary: string;
  iterationResults: IterationResult[];
  latestToolResults: import("../types.js").ToolExecutionResult[];
  executionMachine: ExecutionStateMachine;
}

export function createExecutionStateMachine(
  artifactState: ArtifactState,
  summary?: ExecutionSummary | null
): ExecutionStateMachine {
  return new ExecutionStateMachine({
    summary,
    onTransition: async (transition) => {
      await persistExecutionTransition(artifactState, transition);
    }
  });
}

export function createRuntimeDependencies(repoRoot: string, rules: RulesConfig, logger: Logger): RuntimeDependencies {
  const plannerProvider = createProvider("planner", rules, logger);
  const reviewerProvider = createProvider("reviewer", rules, logger);
  const generatorProvider = createProvider("generator", rules, logger);
  const fixerProvider = createProvider("fixer", rules, logger);

  return {
    plannerProvider,
    reviewerProvider,
    generatorProvider,
    fixerProvider,
    planner: new PlannerAgent({ provider: plannerProvider, rules }),
    reviewer: new ReviewerAgent({ provider: reviewerProvider, rules }),
    generator: new GeneratorAgent({ provider: generatorProvider, rules }),
    fixer: new FixerAgent({ provider: fixerProvider, rules }),
    memory: createMemoryAdapter({ repoRoot, rules, logger }),
    providerSummary: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider })
  };
}

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
  rules: RulesConfig,
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

export async function executeGenerationLoop({
  startIteration,
  task,
  dryRun,
  pauseAfterPlan,
  pauseAfterGenerate,
  repoRoot,
  configPath,
  plan,
  skippedFiles,
  implementationMemoryContext,
  runtime,
  memoryStats,
  artifactState,
  initialState,
  contextFiles,
  rules,
  logger,
  confirmCheckpoint,
  successResultStatus,
  successPersistedStatus
}: {
  startIteration: number;
  task: string;
  dryRun: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  skippedFiles: string[];
  implementationMemoryContext: string;
  runtime: RuntimeDependencies;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
  initialState: LoopExecutionState;
  contextFiles: ContextFile[];
  rules: RulesConfig;
  logger: Logger;
  confirmCheckpoint: (message: string, artifactPath?: string | null) => Promise<boolean>;
  successResultStatus?: RunStatus;
  successPersistedStatus: RunStatus;
}): Promise<{ result: OrchestratorResult | null; state: LoopExecutionState }> {
  const state: LoopExecutionState = {
    currentResult: initialState.currentResult,
    acceptedIssues: [...initialState.acceptedIssues],
    latestReviewSummary: initialState.latestReviewSummary,
    iterationResults: [...initialState.iterationResults],
    latestToolResults: [...initialState.latestToolResults],
    executionMachine: initialState.executionMachine
  };

  for (let iteration = startIteration; iteration <= rules.max_iterations; iteration += 1) {
    logger.step(`Generation loop ${iteration}/${rules.max_iterations}${startIteration > 1 ? " (resumed)" : ""}`);
    const iterationStartedAt = Date.now();

    const generationStage = iteration === 1 && !state.currentResult ? "iteration-generate" : "iteration-fix";
    const generation = await state.executionMachine.runStage(
      generationStage,
      async () =>
        await generateCandidate({
          iteration,
          task,
          plan,
          currentResult: state.currentResult,
          latestReviewSummary: state.latestReviewSummary,
          acceptedIssues: state.acceptedIssues,
          repoRoot,
          implementationMemoryContext,
          contextFiles,
          runtime
        }),
      {
        iteration,
        detail: iteration === 1 && !state.currentResult ? "Generating candidate files." : "Fixing blocking issues from prior review."
      }
    );
    state.currentResult = generation.result;

    state.currentResult.files = sanitizeGeneratedFiles(state.currentResult.files, plan, rules, repoRoot);
    if (state.currentResult.files.length === 0) {
      throw new Error("Generator returned no safe files to write.");
    }

    const originals = await readOriginalFiles(repoRoot, state.currentResult.files.map((file) => file.path));
    const originalFiles = state.currentResult.files.map((file) => ({
      path: file.path,
      content: originals.get(file.path)
    }));
    const diffSummaries = buildDiffSummaries(originalFiles, state.currentResult.files);
    const validationIssues = validateCandidateFiles(state.currentResult.files);

    const toolExecution = await state.executionMachine.runStage(
      "iteration-tools",
      async () => {
        if (!dryRun) {
          return await runToolChecks({
            repoRoot,
            changedFiles: state.currentResult!.files,
            rules,
            logger
          });
        }

        logger.info("Skipping command-based tool checks in dry-run mode until a full isolated repo sandbox is available.");
        return await createDryRunToolExecutionSummary({
          repoRoot,
          rules,
          reason: "dry-run mode does not materialize a complete repository sandbox yet"
        });
      },
      {
        iteration,
        detail: "Running repository tool checks for generated files."
      }
    );

    state.latestToolResults = toolExecution.result.results;
    const preReviewIssues = mergeIssues(toolExecution.result.issues, validationIssues);

    logger.step(`Reviewing generated files with ${runtime.reviewerProvider.id}`);
    const reviewStage = await state.executionMachine.runStage(
      "iteration-review",
      async () =>
        normalizeReviewResult(
          await runtime.reviewer.reviewCode(
            task,
            originalFiles,
            state.currentResult!.files,
            preReviewIssues,
            diffSummaries,
            repoRoot,
            implementationMemoryContext
          )
        ),
      {
        iteration,
        detail: `Reviewer provider: ${runtime.reviewerProvider.id}.`
      }
    );
    const review = reviewStage.result;

    state.latestReviewSummary = review.summary;
    state.acceptedIssues = mergeIssues(review.issues, preReviewIssues);
    const artifactInfo = await persistIterationArtifacts(
      artifactState,
      {
        iteration,
        task,
        dryRun,
        plan,
        provider: iteration === 1 ? runtime.generatorProvider.id : runtime.fixerProvider.id,
        resultSummary: state.currentResult.summary ?? "",
        candidateFiles: state.currentResult.files,
        originalFiles,
        diffSummaries,
        toolResults: toolExecution.result.results,
        preReviewIssues,
        reviewSummary: review.summary,
        issues: state.acceptedIssues,
        durationMs: Date.now() - iterationStartedAt
      },
      logger
    );

    const iterationDurationMs = Date.now() - iterationStartedAt;
    state.iterationResults.push({
      iteration,
      summary: review.summary,
      issues: state.acceptedIssues,
      toolResults: toolExecution.result.results,
      durationMs: iterationDurationMs,
      artifactPath: artifactInfo?.iterationPath ?? null
    });

    if (pauseAfterGenerate) {
      const confirmed = await confirmCheckpoint(
        `Generation checkpoint saved for iteration ${iteration}. Review the candidate files before continuing?`,
        artifactInfo?.iterationPath ?? artifactState.latestIterationPath
      );
      if (!confirmed) {
        logger.warn("Task paused by user after generation checkpoint.");
        await state.executionMachine.pauseStage("paused", {
          iteration,
          durationMs: 0,
          detail: `Paused after generation checkpoint with ${state.acceptedIssues.length} issue(s).`
        });
        const result = buildStoppedResult({
          status: "paused_after_generate",
          dryRun,
          repoRoot,
          configPath,
          plan,
          result: state.currentResult,
          iterations: state.iterationResults,
          skippedContextFiles: skippedFiles,
          finalIssues: state.acceptedIssues,
          providers: runtime.providerSummary,
          memoryStats,
          artifactState,
          latestToolResults: state.latestToolResults,
          executionSteps: state.executionMachine.getSteps(),
          executionTransitions: state.executionMachine.getTransitions()
        });
        await persistRunState(
          artifactState,
          {
            ...result,
            task,
            pauseAfterPlan,
            pauseAfterGenerate,
            latestReviewSummary: state.latestReviewSummary,
            latestToolResults: state.latestToolResults,
            execution: result.execution,
            executionTransitions: state.executionMachine.getTransitions()
          },
          logger
        );
        return { result, state };
      }
    }

    if (!hasBlockingIssues(state.acceptedIssues)) {
      const result = await finalizeSuccessfulRun({
        task,
        dryRun,
        pauseAfterPlan,
        pauseAfterGenerate,
        repoRoot,
        configPath,
        plan,
        skippedFiles,
        runtime,
        memoryStats,
        artifactState,
      state,
      resultStatus: successResultStatus,
      persistedStatus: successPersistedStatus,
      logger
      });
      return { result, state };
    }
  }

  return { result: null, state };
}

export async function finalizeSuccessfulRun({
  task,
  dryRun,
  pauseAfterPlan,
  pauseAfterGenerate,
  repoRoot,
  configPath,
  plan,
  skippedFiles,
  runtime,
  memoryStats,
  artifactState,
  state,
  resultStatus,
  persistedStatus,
  logger
}: {
  task: string;
  dryRun: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  skippedFiles: string[];
  runtime: RuntimeDependencies;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
  state: LoopExecutionState;
  resultStatus?: RunStatus;
  persistedStatus: RunStatus;
  logger: Logger;
}): Promise<OrchestratorResult> {
  if (!state.currentResult) {
    throw new Error("Missing generation result while finalizing success.");
  }

  const originals = await readOriginalFiles(repoRoot, state.currentResult.files.map((file) => file.path));
  if (!dryRun) {
    logger.step("Writing files atomically");
    await state.executionMachine.runStage(
      "write-files",
      async () => {
        await writeFilesAtomically(repoRoot, state.currentResult?.files ?? [], originals);
      },
      { detail: `${state.currentResult.files.length} file(s) written.` }
    );
  } else {
    await state.executionMachine.skipStage("write-files", {
      durationMs: 0,
      detail: "Dry run skipped file writes."
    });
  }

  const memoryStore = await state.executionMachine.runStage(
    "memory-store",
    async () =>
      await safelyStoreMemory(
        runtime.memory,
        {
          task,
          plan,
          result: state.currentResult,
          iterations: state.iterationResults,
          issueCounts: summarizeIssueCounts(state.acceptedIssues),
          providers: runtime.providerSummary,
          success: true,
          dryRun
        },
        logger
      ),
    {
      detail: "Persisted successful run summary to memory."
    }
  );
  memoryStats.stored = memoryStore.result;
  await state.executionMachine.completeStage("success", {
    durationMs: 0,
    detail: "Run completed successfully."
  });

  const execution = buildExecutionSummary({
    status: resultStatus ?? persistedStatus,
    steps: state.executionMachine.getSteps(),
    transitions: state.executionMachine.getTransitions(),
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults
  });

  const result: OrchestratorResult = {
    ok: true,
    ...(resultStatus ? { status: resultStatus } : {}),
    dryRun,
    repoRoot,
    configPath,
    plan,
    result: state.currentResult,
    iterations: state.iterationResults,
    issueCounts: summarizeIssueCounts(state.acceptedIssues),
    skippedContextFiles: skippedFiles,
    finalIssues: state.acceptedIssues,
    providers: runtime.providerSummary,
    memory: memoryStats,
    artifacts: finalizeArtifactState(artifactState, state.currentResult, true, state.latestToolResults, [], [], execution),
    latestToolResults: state.latestToolResults,
    execution,
    wroteFiles: !dryRun
  };

  await persistRunState(
    artifactState,
    {
      ...result,
      status: persistedStatus,
      task,
      pauseAfterPlan,
      pauseAfterGenerate,
      latestReviewSummary: state.latestReviewSummary,
      latestToolResults: state.latestToolResults,
      execution,
      executionTransitions: state.executionMachine.getTransitions()
    },
    logger
  );

  return result;
}

export async function finalizeFailedRun({
  task,
  dryRun,
  pauseAfterPlan,
  pauseAfterGenerate,
  repoRoot,
  configPath,
  plan,
  skippedFiles,
  runtime,
  memoryStats,
  artifactState,
  state,
  resultStatus,
  persistedStatus,
  logger
}: {
  task: string;
  dryRun: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  skippedFiles: string[];
  runtime: RuntimeDependencies;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
  state: LoopExecutionState;
  resultStatus?: RunStatus;
  persistedStatus: RunStatus;
  logger: Logger;
}): Promise<OrchestratorResult> {
  const memoryStore = await state.executionMachine.runStage(
    "memory-store",
    async () =>
      await safelyStoreMemory(
        runtime.memory,
        {
          task,
          plan,
          result: state.currentResult,
          iterations: state.iterationResults,
          issueCounts: summarizeIssueCounts(state.acceptedIssues),
          providers: runtime.providerSummary,
          success: false,
          dryRun
        },
        logger
      ),
    {
      detail: "Persisted failed run summary to memory."
    }
  );
  memoryStats.stored = memoryStore.result;
  await state.executionMachine.completeStage("failure", {
    durationMs: 0,
    detail: "Run finished with blocking issues or failed checks."
  });

  const execution = buildExecutionSummary({
    status: resultStatus ?? persistedStatus,
    steps: state.executionMachine.getSteps(),
    transitions: state.executionMachine.getTransitions(),
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults
  });

  const result: OrchestratorResult = {
    ok: false,
    ...(resultStatus ? { status: resultStatus } : {}),
    dryRun,
    repoRoot,
    configPath,
    plan,
    result: state.currentResult,
    iterations: state.iterationResults,
    issueCounts: summarizeIssueCounts(state.acceptedIssues),
    skippedContextFiles: skippedFiles,
    finalIssues: state.acceptedIssues,
    providers: runtime.providerSummary,
    memory: memoryStats,
    artifacts: finalizeArtifactState(artifactState, state.currentResult, false, state.latestToolResults, [], [], execution),
    latestToolResults: state.latestToolResults,
    execution,
    wroteFiles: false
  };

  await persistRunState(
    artifactState,
    {
      ...result,
      status: persistedStatus,
      task,
      pauseAfterPlan,
      pauseAfterGenerate,
      latestReviewSummary: state.latestReviewSummary,
      latestToolResults: state.latestToolResults,
      execution,
      executionTransitions: state.executionMachine.getTransitions()
    },
    logger
  );

  return result;
}

function sanitizeGeneratedFiles(files: unknown, plan: PlanResult, rules: RulesConfig, repoRoot: string): GeneratedFile[] {
  const allowedTargets = new Set(plan.writeTargets);
  const safeFiles: GeneratedFile[] = [];

  for (const file of Array.isArray(files) ? files : []) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      continue;
    }

    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!normalizedPath || normalizedPath.includes("..") || path.isAbsolute(normalizedPath)) {
      continue;
    }

    if (allowedTargets.size > 0 && !allowedTargets.has(normalizedPath)) {
      continue;
    }

    resolveRepoPath(repoRoot, normalizedPath);
    safeFiles.push({
      path: normalizedPath,
      action: file.action === "create" ? "create" : "update",
      content: file.content
    });
  }

  return dedupeByPath(safeFiles).slice(0, rules.max_write_files ?? 8);
}

function dedupeByPath(files: GeneratedFile[]): GeneratedFile[] {
  const map = new Map<string, GeneratedFile>();
  for (const file of files) {
    map.set(file.path, file);
  }
  return [...map.values()];
}

function summarizeProviders({
  plannerProvider,
  reviewerProvider,
  generatorProvider,
  fixerProvider
}: {
  plannerProvider: { id: string };
  reviewerProvider: { id: string };
  generatorProvider: { id: string };
  fixerProvider: { id: string };
}): ProviderSummary {
  return {
    planner: plannerProvider.id,
    reviewer: reviewerProvider.id,
    generator: generatorProvider.id,
    fixer: fixerProvider.id
  };
}

async function generateCandidate({
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

async function safelySearchMemory(memory: MemoryAdapter, payload: Parameters<MemoryAdapter["searchRelevant"]>[0], logger?: Logger) {
  try {
    return await memory.searchRelevant(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory search failed: ${normalized.message}`);
    return [];
  }
}

async function safelyStoreMemory(memory: MemoryAdapter, payload: Parameters<MemoryAdapter["storeRunSummary"]>[0], logger?: Logger) {
  try {
    return await memory.storeRunSummary(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory store failed: ${normalized.message}`);
    return false;
  }
}
