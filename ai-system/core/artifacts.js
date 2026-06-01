import { buildExecutionSummary } from "./execution-summary.js";
import { summarizeIssueCounts } from "./reviewer.js";
export * from "./artifact-types.js";
export * from "./artifact-utils.js";
export * from "./artifact-persistence.js";
export * from "./artifact-query.js";
import { finalizeArtifactState } from "./artifact-persistence.js";
/**
 * Builds an OrchestratorResult representing a run that was stopped (e.g. paused for approval).
 */
export function buildStoppedResult({ status, dryRun, repoRoot, configPath, plan, result = null, iterations = [], skippedContextFiles = [], finalIssues = [], providers, memoryStats, artifactState, latestToolResults = [], latestVectorMatches = [], latestContextRanking = [], executionSteps = [], executionTransitions = [], budgetConfig = null, usageMetrics = [], approvalPolicy = null, externalTask = null, externalUpdatePreviews = [] }) {
    const execution = buildExecutionSummary({
        status,
        steps: executionSteps,
        transitions: executionTransitions,
        budgetConfig,
        providers,
        finalIssues,
        latestToolResults,
        iterations,
        usageMetrics
    });
    return {
        version: 1,
        ok: false,
        status,
        dryRun,
        repoRoot,
        configPath,
        plan,
        result,
        iterations,
        issueCounts: summarizeIssueCounts(finalIssues),
        skippedContextFiles,
        finalIssues,
        providers,
        memory: memoryStats,
        artifacts: finalizeArtifactState(artifactState, result, false, latestToolResults, latestVectorMatches, latestContextRanking, execution),
        latestToolResults,
        execution,
        approvalPolicy,
        externalTask: externalTask ?? undefined,
        externalUpdatePreviews,
        wroteFiles: false
    };
}
