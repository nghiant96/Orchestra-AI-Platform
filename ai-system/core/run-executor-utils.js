import path from "node:path";
import { resolveRepoPath } from "./context.js";
import { hasBlockingIssues } from "./reviewer.js";
import { buildExecutionBudgetSummary, buildExecutionSummary } from "./execution-summary.js";
export function collectProviderUsageMetrics(runtime) {
    return [
        ...(runtime.plannerProvider.getUsage?.() ?? []),
        ...(runtime.reviewerProvider.getUsage?.() ?? []),
        ...(runtime.generatorProvider.getUsage?.() ?? []),
        ...(runtime.fixerProvider.getUsage?.() ?? [])
    ];
}
export function getExecutionBudgetSummary(state, runtime, budgetConfig) {
    return buildExecutionBudgetSummary({
        totalDurationMs: state.executionMachine.getSteps().reduce((total, step) => total + Math.max(0, step.durationMs || 0), 0),
        providerMetrics: buildExecutionSummary({
            steps: state.executionMachine.getSteps(),
            transitions: state.executionMachine.getTransitions(),
            providers: runtime.providerSummary,
            usageMetrics: collectProviderUsageMetrics(runtime)
        }).providerMetrics ?? [],
        budgetConfig,
        retryCount: Math.max(0, state.iterationResults.length)
    });
}
export function createBudgetRetryHint(state, budget, nextIteration) {
    if (budget.maxRetries !== null && budget.retryCount >= budget.maxRetries) {
        return null;
    }
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
export function sanitizeGeneratedFiles(files, plan, rules, repoRoot) {
    const allowedTargets = new Set([...plan.writeTargets, ...plan.readFiles]);
    const safeFiles = [];
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
export function findMissingPlannedWriteTargets(files, plan) {
    if (!Array.isArray(plan.writeTargets) || plan.writeTargets.length === 0) {
        return [];
    }
    const generatedPaths = new Set(files.map((file) => file.path));
    return [...new Set(plan.writeTargets)].filter((target) => !generatedPaths.has(target));
}
export function buildIncompleteGenerationIssue(missingWriteTargets) {
    return {
        severity: "high",
        category: "generation",
        path: missingWriteTargets[0] ?? "",
        description: `The candidate is incomplete and does not include all planned write targets: ${missingWriteTargets.join(", ")}.`,
        risk: "Tool checks must not run until all planned write targets are generated.",
        suggestedFix: "Generate the missing planned write targets before running lint, typecheck, or review."
    };
}
export function dedupeByPath(files) {
    const map = new Map();
    for (const file of files) {
        map.set(file.path, file);
    }
    return [...map.values()];
}
export function summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }) {
    return {
        planner: plannerProvider.id,
        reviewer: reviewerProvider.id,
        generator: generatorProvider.id,
        fixer: fixerProvider.id
    };
}
export async function safelySearchMemory(memory, payload, logger) {
    try {
        return await memory.searchRelevant(payload);
    }
    catch (error) {
        const normalized = error;
        logger?.warn(`Memory search failed: ${normalized.message}`);
        return [];
    }
}
export async function safelyStoreMemory(memory, payload, logger) {
    try {
        return await memory.storeRunSummary(payload);
    }
    catch (error) {
        const normalized = error;
        logger?.warn(`Memory store failed: ${normalized.message}`);
        return false;
    }
}
export function shouldUseStrictReview(approvalPolicy) {
    return approvalPolicy?.riskClass === "high";
}
