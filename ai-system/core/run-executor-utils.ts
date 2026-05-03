import path from "node:path";
import type {
  ExecutionBudgetSummary,
  ExecutionBudgetConfig,
  GeneratedFile,
  Logger,
  MemoryAdapter,
  PlanResult,
  ProviderUsageMetric,
  RetryHint,
  ReviewIssue,
  RulesConfig,
  ProviderSummary,
  ApprovalPolicyDecision
} from "../types.js";
import { resolveRepoPath } from "./context.js";
import { hasBlockingIssues } from "./reviewer.js";
import { buildExecutionBudgetSummary, buildExecutionSummary } from "./execution-summary.js";
import type { LoopExecutionState, RuntimeDependencies } from "./run-executor-types.js";

export function collectProviderUsageMetrics(runtime: RuntimeDependencies): ProviderUsageMetric[] {
  return [
    ...(runtime.plannerProvider.getUsage?.() ?? []),
    ...(runtime.reviewerProvider.getUsage?.() ?? []),
    ...(runtime.generatorProvider.getUsage?.() ?? []),
    ...(runtime.fixerProvider.getUsage?.() ?? [])
  ];
}

export function getExecutionBudgetSummary(
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

export function createBudgetRetryHint(
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

export function buildIncompleteGenerationIssue(missingWriteTargets: string[]): ReviewIssue {
  return {
    severity: "high",
    category: "generation",
    path: missingWriteTargets[0] ?? "",
    description: `The candidate is incomplete and does not include all planned write targets: ${missingWriteTargets.join(", ")}.`,
    risk: "Tool checks must not run until all planned write targets are generated.",
    suggestedFix: "Generate the missing planned write targets before running lint, typecheck, or review."
  };
}

export function dedupeByPath(files: GeneratedFile[]): GeneratedFile[] {
  const map = new Map<string, GeneratedFile>();
  for (const file of files) {
    map.set(file.path, file);
  }
  return [...map.values()];
}

export function summarizeProviders({
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

export async function safelySearchMemory(memory: MemoryAdapter, payload: Parameters<MemoryAdapter["searchRelevant"]>[0], logger?: Logger) {
  try {
    return await memory.searchRelevant(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory search failed: ${normalized.message}`);
    return [];
  }
}

export async function safelyStoreMemory(memory: MemoryAdapter, payload: Parameters<MemoryAdapter["storeRunSummary"]>[0], logger?: Logger) {
  try {
    return await memory.storeRunSummary(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory store failed: ${normalized.message}`);
    return false;
  }
}

export function shouldUseStrictReview(approvalPolicy?: ApprovalPolicyDecision | null): boolean {
  return approvalPolicy?.riskClass === "high";
}
