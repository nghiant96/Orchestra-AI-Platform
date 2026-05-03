import { buildBlastRadiusContext } from "./blast-radius.js";
import { detectMissingTests } from "./test-heuristics.js";
import { DependencyGraph } from "./dependency-graph.js";
import type {
  ContextFile,
  ExecutionBudgetConfig,
  Logger,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  RunStatus,
  RulesConfig,
  ApprovalPolicyDecision
} from "../types.js";
import { createDryRunToolExecutionSummary, runToolChecks } from "./tool-executor.js";
import { readOriginalFiles } from "./context.js";
import {
  buildDiffSummaries,
  hasBlockingIssues,
  mergeIssues,
  normalizeReviewResult,
  validateCandidateFiles
} from "./reviewer.js";
import {
  buildStoppedResult,
  persistIterationArtifacts,
  persistRunState,
  type ArtifactState
} from "./artifacts.js";
import { buildExecutionSummary } from "./execution-summary.js";
import { validateTaskContractCoverage, validateTaskRequirementCoverage } from "./task-requirements.js";

export * from "./run-executor-types.js";
export * from "./run-executor-utils.js";
export * from "./run-executor-state.js";
export * from "./run-executor-steps.js";
export * from "./run-executor-finalize.js";

import {
  collectProviderUsageMetrics,
  getExecutionBudgetSummary,
  createBudgetRetryHint,
  sanitizeGeneratedFiles,
  findMissingPlannedWriteTargets,
  buildIncompleteGenerationIssue,
  shouldUseStrictReview
} from "./run-executor-utils.js";
import {
  finalizeFailedRun,
  finalizeSuccessfulRun
} from "./run-executor-finalize.js";
import { generateCandidate } from "./run-executor-steps.js";
import type { LoopExecutionState, RuntimeDependencies } from "./run-executor-types.js";

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
