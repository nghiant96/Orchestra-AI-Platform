import path from "node:path";
import { PlannerAgent } from "../agents/planner.js";
import { GeneratorAgent } from "../agents/generator.js";
import { FixerAgent } from "../agents/fixer.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { buildBlastRadiusContext } from "./blast-radius.js";
import { detectMissingTests } from "./test-heuristics.js";
import { reconcileTestPlan } from "./test-reconciliation.js";
import { DependencyGraph } from "./dependency-graph.js";
import { createProvider } from "../providers/registry.js";
import { createMemoryAdapter } from "../memory/registry.js";
import type {
  ContextFile,
  ExecutionBudgetConfig,
  ExecutionBudgetSummary,
  ExecutionSummary,
  ApprovalPolicyDecision,
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
  ProviderUsageMetric,
  RetryHint,
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
import { buildExecutionBudgetSummary, buildExecutionSummary } from "./execution-summary.js";
import { ExecutionStateMachine } from "./execution-state-machine.js";
import { validateTaskContractCoverage, validateTaskRequirementCoverage } from "./task-requirements.js";

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
  diffSummaries?: import("../types.js").DiffSummary[];
  latestToolResults: import("../types.js").ToolExecutionResult[];
  executionMachine: ExecutionStateMachine;
}

export function createExecutionStateMachine(
  artifactState: ArtifactState,
  summary?: ExecutionSummary | null,
  logger?: Logger
): ExecutionStateMachine {
  return new ExecutionStateMachine({
    summary,
    onTransition: async (transition) => {
      logger?.dashboard?.({
        transition,
        message: transition.detail ? `${transition.stage}: ${transition.detail}` : `${transition.stage}: ${transition.status}`,
        artifactPath: artifactState.runDir
      });
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
  resumeFromStage,
  successResultStatus,
  successPersistedStatus,
  budgetConfig,
  approvalPolicy = null,
  externalTask = null,
  externalUpdatePreviews = [],
  toolChecks = runToolChecks,
  signal
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
  resumeFromStage?: "iteration-generate" | "iteration-tools";
  successResultStatus?: RunStatus;
  successPersistedStatus: RunStatus;
  budgetConfig?: ExecutionBudgetConfig | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
  toolChecks?: typeof runToolChecks;
  signal?: AbortSignal;
}): Promise<{ result: OrchestratorResult | null; state: LoopExecutionState }> {
  if (signal?.aborted) throw new Error('AbortError');
  const state: LoopExecutionState = {
    currentResult: initialState.currentResult,
    acceptedIssues: [...initialState.acceptedIssues],
    latestReviewSummary: initialState.latestReviewSummary,
    iterationResults: [...initialState.iterationResults],
    latestToolResults: [...initialState.latestToolResults],
    executionMachine: initialState.executionMachine
  };
  let pendingResumeStage = resumeFromStage;

  const dependencyGraph = new DependencyGraph(repoRoot);
  await dependencyGraph.buildGraph([...plan.readFiles, ...plan.writeTargets]);

  for (let iteration = startIteration; iteration <= rules.max_iterations; iteration += 1) {
    const preIterationBudget = getExecutionBudgetSummary(state, runtime, budgetConfig);
    if (preIterationBudget?.exceeded) {
      const result = await finalizeFailedRun({
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
        retryHint: createBudgetRetryHint(state, preIterationBudget, startIteration),
        resultStatus: "failed",
        persistedStatus: "failed",
        budgetConfig,
        approvalPolicy,
        externalTask,
        externalUpdatePreviews,
        logger
      });
      return { result, state };
    }

    logger.step(`Generation loop ${iteration}/${rules.max_iterations}${startIteration > 1 ? " (resumed)" : ""}`);
    const iterationStartedAt = Date.now();
    const shouldSkipGeneration = pendingResumeStage === "iteration-tools" && iteration === startIteration;

    if (!shouldSkipGeneration) {
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
      logger.dashboard?.({
        message: `Generated ${state.currentResult.files.length} candidate file(s).`,
        currentFiles: state.currentResult.files.map((file) => file.path),
        providerMetrics: buildExecutionSummary({
          steps: state.executionMachine.getSteps(),
          transitions: state.executionMachine.getTransitions(),
          providers: runtime.providerSummary,
          usageMetrics: collectProviderUsageMetrics(runtime)
        }).providerMetrics ?? []
      });
    } else if (!state.currentResult) {
      throw new Error("Cannot resume tool/review stages without a current generation result.");
    }

    state.currentResult.files = sanitizeGeneratedFiles(state.currentResult.files, plan, rules, repoRoot);
    if (state.currentResult.files.length === 0) {
      throw new Error("Generator returned no safe files to write.");
    }

    const originals = await readOriginalFiles(repoRoot, state.currentResult.files.map((file) => file.path));
    const originalFiles = state.currentResult.files.map((file) => ({
      path: file.path,
      content: originals.get(file.path)
    }));
    state.diffSummaries = buildDiffSummaries(originalFiles, state.currentResult.files);

    const missingWriteTargets = findMissingPlannedWriteTargets(state.currentResult.files, plan);
    if (missingWriteTargets.length > 0) {
      const incompleteSummary = `Generation incomplete: missing planned write target(s): ${missingWriteTargets.join(", ")}.`;
      const incompleteIssue = buildIncompleteGenerationIssue(missingWriteTargets);
      state.latestReviewSummary = incompleteSummary;
      state.acceptedIssues = mergeIssues(state.acceptedIssues, [incompleteIssue]);

      const incompleteDurationMs = Date.now() - iterationStartedAt;
      const artifactInfo = await persistIterationArtifacts(
        artifactState,
        {
          iteration,
          task,
          dryRun,
          plan,
          provider: iteration === 1 ? runtime.generatorProvider.id : runtime.fixerProvider.id,
          resultSummary: incompleteSummary,
          candidateFiles: state.currentResult.files,
          originalFiles,
          diffSummaries: state.diffSummaries,
          toolResults: [],
          preReviewIssues: [incompleteIssue],
          reviewSummary: incompleteSummary,
          issues: state.acceptedIssues,
          durationMs: incompleteDurationMs
        },
        logger
      );

      state.iterationResults.push({
        iteration,
        summary: incompleteSummary,
        issues: state.acceptedIssues,
        toolResults: [],
        missingTests: [],
        durationMs: incompleteDurationMs,
        artifactPath: artifactInfo?.iterationPath ?? null
      });
      logger.warn(incompleteSummary);
      logger.dashboard?.({
        message: `Iteration ${iteration} incomplete: waiting for ${missingWriteTargets.length} missing write target(s).`,
        artifactPath: artifactInfo?.iterationPath ?? artifactState.latestIterationPath,
        currentFiles: state.currentResult.files.map((file) => file.path),
        diffSummaries: state.diffSummaries,
        providerMetrics: buildExecutionSummary({
          steps: state.executionMachine.getSteps(),
          transitions: state.executionMachine.getTransitions(),
          providers: runtime.providerSummary,
          usageMetrics: collectProviderUsageMetrics(runtime)
        }).providerMetrics ?? [],
        budget: getExecutionBudgetSummary(state, runtime, budgetConfig)
      });
      pendingResumeStage = undefined;
      continue;
    }

    const validationIssues = [
      ...validateCandidateFiles(state.currentResult.files),
      ...(plan.contracts?.length
        ? validateTaskContractCoverage(plan.contracts, state.currentResult.files)
        : validateTaskRequirementCoverage(task, state.currentResult.files))
    ];

    const toolExecution = await state.executionMachine.runStage(
      "iteration-tools",
      async () => {
        if (!dryRun) {
          return await toolChecks({
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

    const blastRadius = await buildBlastRadiusContext({
      repoRoot,
      changedFiles: state.currentResult!.files.map((f) => f.path),
      dependencyGraph,
      contracts: plan.contracts,
      toolResults: state.latestToolResults
    });

    logger.step(`Reviewing generated files with ${runtime.reviewerProvider.id}`);
    const reviewStage = await state.executionMachine.runStage(
      "iteration-review",
      async () =>
        normalizeReviewResult(
          await runtime.reviewer.reviewCode(
            task,
            plan,
            shouldUseStrictReview(approvalPolicy),
            originalFiles,
            state.currentResult!.files,
            preReviewIssues,
            state.diffSummaries!,
            repoRoot,
            implementationMemoryContext,
            blastRadius
          )
        ),
      {
        iteration,
        detail: `Reviewer provider: ${runtime.reviewerProvider.id}.`
      }
    );
    const review = reviewStage.result;
    const missingTests = detectMissingTests({
      changedFiles: state.currentResult!.files.map((f) => f.path),
      blastRadius,
      toolResults: toolExecution.result.results
    });
    review.missingTests = missingTests;

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
        diffSummaries: state.diffSummaries,
        toolResults: toolExecution.result.results,
        preReviewIssues,
        reviewSummary: review.summary,
        issues: state.acceptedIssues,
        durationMs: Date.now() - iterationStartedAt
      },
      logger
    );
    logger.dashboard?.({
      message: `Iteration ${iteration} review complete.`,
      diffSummaries: state.diffSummaries,
      artifactPath: artifactInfo?.iterationPath ?? artifactState.latestIterationPath,
      currentFiles: state.currentResult.files.map((file) => file.path),
      providerMetrics: buildExecutionSummary({
        steps: state.executionMachine.getSteps(),
        transitions: state.executionMachine.getTransitions(),
        providers: runtime.providerSummary,
        usageMetrics: collectProviderUsageMetrics(runtime)
      }).providerMetrics ?? [],
      budget: getExecutionBudgetSummary(state, runtime, budgetConfig)
    });

    const iterationDurationMs = Date.now() - iterationStartedAt;
    state.iterationResults.push({
      iteration,
      summary: review.summary,
      issues: state.acceptedIssues,
      toolResults: toolExecution.result.results,
      missingTests: review.missingTests,
      durationMs: iterationDurationMs,
      artifactPath: artifactInfo?.iterationPath ?? null
    });

    const postIterationBudget = getExecutionBudgetSummary(state, runtime, budgetConfig);
    if (postIterationBudget?.exceeded) {
      const result = await finalizeFailedRun({
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
        retryHint: createBudgetRetryHint(state, postIterationBudget, iteration + 1),
        resultStatus: "failed",
        persistedStatus: "failed",
        budgetConfig,
        approvalPolicy,
        externalTask,
        externalUpdatePreviews,
        logger
      });
      return { result, state };
    }

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
          executionTransitions: state.executionMachine.getTransitions(),
          budgetConfig,
          usageMetrics: collectProviderUsageMetrics(runtime),
          approvalPolicy,
          externalTask: externalTask ?? undefined,
          externalUpdatePreviews
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
            approvalPolicy,
            executionTransitions: state.executionMachine.getTransitions()
          },
          logger
        );
        return { result, state };
      }
    }

    if (!hasBlockingIssues(state.acceptedIssues)) {
      const successBudget = getExecutionBudgetSummary(state, runtime, budgetConfig);
      if (successBudget?.exceeded) {
        const result = await finalizeFailedRun({
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
          retryHint: createBudgetRetryHint(state, successBudget, iteration),
          resultStatus: "failed",
          persistedStatus: "failed",
          budgetConfig,
          approvalPolicy,
          logger
        });
        return { result, state };
      }
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
        budgetConfig,
        approvalPolicy,
        externalTask,
        externalUpdatePreviews,
        logger
      });
      return { result, state };
    }

    pendingResumeStage = undefined;
  }

  return { result: null, state };
}

export function shouldUseStrictReview(approvalPolicy?: ApprovalPolicyDecision | null): boolean {
  return approvalPolicy?.riskClass === "high";
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
  startAtStage,
  resultStatus,
  persistedStatus,
  budgetConfig,
  approvalPolicy = null,
  externalTask = null,
  externalUpdatePreviews: _externalUpdatePreviews = [],
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
  startAtStage?: "write-files" | "memory-store";
  resultStatus?: RunStatus;
  persistedStatus: RunStatus;
  budgetConfig?: ExecutionBudgetConfig | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
  logger: Logger;
}): Promise<OrchestratorResult> {
  if (!state.currentResult) {
    throw new Error("Missing generation result while finalizing success.");
  }

  const originals = await readOriginalFiles(repoRoot, state.currentResult.files.map((file) => file.path));
  if (!dryRun && startAtStage !== "memory-store") {
    logger.step("Writing files atomically");
    await state.executionMachine.runStage(
      "write-files",
      async () => {
        await writeFilesAtomically(repoRoot, state.currentResult?.files ?? [], originals);
      },
      { detail: `${state.currentResult.files.length} file(s) written.` }
    );
  } else if (startAtStage !== "memory-store") {
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
    providers: runtime.providerSummary,
    budgetConfig,
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults,
    usageMetrics: collectProviderUsageMetrics(runtime),
    retryHint: null
  });

  const result: OrchestratorResult = {
    version: 1,
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
    diffSummaries: state.diffSummaries,
    latestToolResults: state.latestToolResults,
    missingTests: [
      ...reconcileTestPlan(plan.testPlan, state.latestToolResults),
      ...(state.iterationResults.at(-1)?.missingTests ?? [])
    ],
    execution,
    approvalPolicy,
    externalTask: externalTask ?? undefined,
    refactorAnalysis: plan.refactorAnalysis,
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
      approvalPolicy,
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
  retryHint,
  startAtStage: _startAtStage,
  resultStatus,
  persistedStatus,
  budgetConfig,
  approvalPolicy = null,
  externalTask = null,
  additionalUsageMetrics = [],
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
  retryHint?: RetryHint | null;
  startAtStage?: "memory-store";
  resultStatus?: RunStatus;
  persistedStatus: RunStatus;
  budgetConfig?: ExecutionBudgetConfig | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
  additionalUsageMetrics?: ProviderUsageMetric[];
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
    providers: runtime.providerSummary,
    budgetConfig,
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults,
    usageMetrics: [...collectProviderUsageMetrics(runtime), ...(additionalUsageMetrics ?? [])],
    retryHint
  });

  const result: OrchestratorResult = {
    version: 1,
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
    diffSummaries: state.diffSummaries,
    latestToolResults: state.latestToolResults,
    missingTests: [
      ...reconcileTestPlan(plan.testPlan, state.latestToolResults),
      ...(state.iterationResults.at(-1)?.missingTests ?? [])
    ],
    execution,
    approvalPolicy,
    externalTask: externalTask ?? undefined,
    refactorAnalysis: plan.refactorAnalysis,
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
      approvalPolicy,
      executionTransitions: state.executionMachine.getTransitions()
    },
    logger
  );

  return result;
}

export async function finalizeErroredRun({
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
  retryHint,
  budgetConfig,
  approvalPolicy = null,
  externalTask = null,
  externalUpdatePreviews: _externalUpdatePreviews = [],
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
  retryHint: RetryHint;
  budgetConfig?: ExecutionBudgetConfig | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  externalTask?: import("../types.js").ExternalTaskRef | null;
  externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
  logger: Logger;
}): Promise<OrchestratorResult> {
  const execution = buildExecutionSummary({
    status: "failed",
    steps: state.executionMachine.getSteps(),
    transitions: state.executionMachine.getTransitions(),
    providers: runtime.providerSummary,
    budgetConfig,
    finalIssues: state.acceptedIssues,
    latestToolResults: state.latestToolResults,
    iterations: state.iterationResults,
    usageMetrics: collectProviderUsageMetrics(runtime),
    retryHint
  });

  const result: OrchestratorResult = {
    version: 1,
    ok: false,
    status: "failed",
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
    diffSummaries: state.diffSummaries,
    latestToolResults: state.latestToolResults,
    missingTests: [
      ...reconcileTestPlan(plan.testPlan, state.latestToolResults),
      ...(state.iterationResults.at(-1)?.missingTests ?? [])
    ],
    execution,
    approvalPolicy,
    externalTask: externalTask ?? undefined,
    refactorAnalysis: plan.refactorAnalysis,
    wroteFiles: false
  };

  await persistRunState(
    artifactState,
    {
      ...result,
      task,
      pauseAfterPlan,
      pauseAfterGenerate,
      latestReviewSummary: state.latestReviewSummary,
      latestToolResults: state.latestToolResults,
      execution,
      approvalPolicy,
      executionTransitions: state.executionMachine.getTransitions()
    },
    logger
  );

  return result;
}

function getExecutionBudgetSummary(
  state: LoopExecutionState,
  runtime: RuntimeDependencies,
  budgetConfig?: ExecutionBudgetConfig | null
): ExecutionBudgetSummary | null {
  return buildExecutionBudgetSummary({
    totalDurationMs: state.executionMachine.getSteps().reduce((total, step) => total + Math.max(0, step.durationMs || 0), 0),
    providerMetrics: buildExecutionSummary({
      steps: state.executionMachine.getSteps(),
      transitions: state.executionMachine.getTransitions(),
      providers: runtime.providerSummary,
      usageMetrics: collectProviderUsageMetrics(runtime)
    }).providerMetrics ?? [],
    budgetConfig
  });
}

export function collectProviderUsageMetrics(runtime: RuntimeDependencies): ProviderUsageMetric[] {
  return [
    ...(runtime.plannerProvider.getUsage?.() ?? []),
    ...(runtime.reviewerProvider.getUsage?.() ?? []),
    ...(runtime.generatorProvider.getUsage?.() ?? []),
    ...(runtime.fixerProvider.getUsage?.() ?? [])
  ];
}

function createBudgetRetryHint(
  state: LoopExecutionState,
  budget: ExecutionBudgetSummary,
  nextIteration: number
): RetryHint {
  if (state.currentResult && !hasBlockingIssues(state.acceptedIssues)) {
    return {
      stage: "write-files",
      reason: `Resume finalization after the ${budget.exceeded} budget was exceeded.`
    };
  }

  if (state.currentResult) {
    return {
      stage: "iteration-fix",
      iteration: Math.max(1, nextIteration),
      reason: `Resume the fix loop after the ${budget.exceeded} budget was exceeded.`
    };
  }

  return {
    stage: "iteration-generate",
    iteration: Math.max(1, nextIteration),
    reason: `Resume generation after the ${budget.exceeded} budget was exceeded.`
  };
}

export function sanitizeGeneratedFiles(files: unknown, plan: PlanResult, rules: RulesConfig, repoRoot: string): GeneratedFile[] {
  const allowedTargets = new Set([...plan.writeTargets, ...plan.readFiles]);
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

export function findMissingPlannedWriteTargets(files: GeneratedFile[], plan: PlanResult): string[] {
  if (!Array.isArray(plan.writeTargets) || plan.writeTargets.length === 0) {
    return [];
  }

  const generatedPaths = new Set(files.map((file) => file.path));
  return [...new Set(plan.writeTargets)].filter((target) => !generatedPaths.has(target));
}

function buildIncompleteGenerationIssue(missingWriteTargets: string[]): ReviewIssue {
  return {
    severity: "high",
    category: "generation",
    path: missingWriteTargets[0] ?? "",
    description: `The candidate is incomplete and does not include all planned write targets: ${missingWriteTargets.join(", ")}.`,
    risk: "Tool checks must not run until all planned write targets are generated.",
    suggestedFix: "Generate the missing planned write targets before running lint, typecheck, or review."
  };
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
