import fs from "node:fs/promises";
import { filterExistingSafeReadFiles, resolveRepoPath } from "./context.js";
import { DependencyGraph } from "./dependency-graph.js";
import { VectorIndex } from "./vector-index.js";
import { runCommand } from "../utils/api.js";
import type { ContextSelectionCandidate, Logger, RulesConfig, VectorSearchMatch } from "../types.js";

export interface ContextExpansionResult {
  readFiles: string[];
  dependencyFiles: string[];
  changedHintFiles: string[];
  budgetTrimmedFiles: string[];
  selectionSummary: ContextSelectionSummary[];
  budgetSummary: ContextBudgetSummary;
  vectorMatches: VectorSearchMatch[];
  rankedCandidates: ContextSelectionCandidate[];
}

export interface ContextSelectionSummary {
  path: string;
  score: number;
  sources: string[];
  inclusionReason?: string;
  exclusionReason?: string;
}

export interface ContextBudgetSummary {
  maxExpandedFiles: number;
  maxContextBytes: number;
  selectedCount: number;
  trimmedCount: number;
  selectedBytes: number;
}

export async function expandContextReadFiles({
  repoRoot,
  rules,
  task,
  prompt,
  initialReadFiles,
  writeTargets,
  logger
}: {
  repoRoot: string;
  rules: RulesConfig;
  task: string;
  prompt?: string;
  initialReadFiles: string[];
  writeTargets?: string[];
  logger?: Logger;
}): Promise<ContextExpansionResult> {
  const safeWriteTargetReads = await filterExistingSafeReadFiles(
    repoRoot,
    writeTargets ?? [],
    rules,
    logger,
    Math.max(writeTargets?.length ?? 0, rules.max_write_files ?? 8)
  );
  const graphSeeds = [...new Set([...initialReadFiles, ...safeWriteTargetReads])];
  const safeChangedFiles = await collectChangedWorkingTreeFiles(repoRoot, rules, logger);
  let dependencyFiles = [...graphSeeds];
  let changedHintFiles: string[] = [];
  if (graphSeeds.length > 0) {
    const graph = new DependencyGraph(repoRoot);
    await graph.buildGraph([...new Set([...graphSeeds, ...safeChangedFiles])]);
    dependencyFiles = await graph.getRelatedFiles(graphSeeds, 1);
    const dependencySet = new Set(dependencyFiles);
    changedHintFiles = safeChangedFiles.filter((file) => dependencySet.has(file));
  }

  let vectorMatches: VectorSearchMatch[] = [];
  if (rules.vector_search?.enabled) {
    const vectorIndex = new VectorIndex({
      repoRoot,
      rules,
      config: rules.vector_search,
      logger
    });
    const indexed = await vectorIndex.indexWorkspace();
    logger?.info(`Indexed ${indexed.fileCount} file(s) into ${indexed.chunkCount} semantic chunk(s).`);
    vectorMatches = await vectorIndex.search(
      [task, prompt, ...(initialReadFiles ?? [])].filter(Boolean).join("\n"),
      rules.vector_search?.max_results
    );
  }

  const rankedCandidates = rankContextCandidates({
    initialReadFiles,
    dependencyFiles,
    writeTargetReads: safeWriteTargetReads,
    changedHintFiles,
    vectorMatches
  });
  const maxExpandedFiles = computeExpandedContextLimit({
    rules,
    initialCount: initialReadFiles.length,
    writeTargetCount: safeWriteTargetReads.length
  });
  const mergedReadFiles = await filterExistingSafeReadFiles(
    repoRoot,
    rankedCandidates.map((entry) => entry.path),
    rules,
    logger,
    rankedCandidates.length
  );
  const budgetedSelection = await trimRankedCandidatesByBudget({
    repoRoot,
    rankedCandidates: rankedCandidates.filter((entry) => mergedReadFiles.includes(entry.path)),
    maxExpandedFiles,
    maxContextBytes: rules.max_context_bytes
  });
  const selectedCandidateMap = new Map(rankedCandidates.map((entry) => [entry.path, entry]));
  const selectionSummary = [
    ...budgetedSelection.selectedPaths.map((path) => {
      const candidate = selectedCandidateMap.get(path);
      return {
        path,
        score: candidate?.score ?? 0,
        sources: candidate?.sources ?? [],
        inclusionReason: candidate?.inclusionReason
      };
    }),
    ...budgetedSelection.trimmedSummaries.map((entry) => ({
      path: entry.path,
      score: selectedCandidateMap.get(entry.path)?.score ?? 0,
      sources: selectedCandidateMap.get(entry.path)?.sources ?? [],
      exclusionReason: entry.reason
    }))
  ];

  return {
    readFiles: budgetedSelection.selectedPaths,
    dependencyFiles,
    changedHintFiles,
    budgetTrimmedFiles: budgetedSelection.trimmedPaths,
    selectionSummary,
    budgetSummary: {
      maxExpandedFiles,
      maxContextBytes: rules.max_context_bytes,
      selectedCount: budgetedSelection.selectedPaths.length,
      trimmedCount: budgetedSelection.trimmedPaths.length,
      selectedBytes: budgetedSelection.selectedBytes
    },
    vectorMatches,
    rankedCandidates: rankedCandidates.filter((entry) => budgetedSelection.selectedPaths.includes(entry.path))
  };
}

export function rankContextCandidates({
  initialReadFiles,
  dependencyFiles,
  writeTargetReads,
  changedHintFiles,
  vectorMatches
}: {
  initialReadFiles: string[];
  dependencyFiles: string[];
  writeTargetReads: string[];
  changedHintFiles: string[];
  vectorMatches: VectorSearchMatch[];
}): ContextSelectionCandidate[] {
  const candidates = new Map<string, ContextSelectionCandidate>();

  const SOURCE_LABELS: Record<string, string> = {
    planner: "explicitly requested by planner",
    "write-target": "target of a planned write operation",
    "changed-file": "detected as changed in working tree",
    dependency: "identified as a dependency of planned files",
    semantic: "matched by semantic similarity search"
  };

  const upsert = (path: string, score: number, source: string) => {
    const existing = candidates.get(path);
    const label = SOURCE_LABELS[source] ?? `matched by ${source} heuristic`;
    if (existing) {
      existing.score = Math.max(existing.score, score);
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      // Upgrade inclusion reason to strongest source
      const existingPriority = Object.keys(SOURCE_LABELS).indexOf(existing.inclusionReason?.split("; ")[0] ?? "");
      const newPriority = Object.keys(SOURCE_LABELS).indexOf(source);
      if (newPriority >= 0 && (existingPriority < 0 || newPriority < existingPriority)) {
        existing.inclusionReason = label;
      }
      return;
    }
    candidates.set(path, {
      path,
      score,
      sources: [source],
      inclusionReason: label
    });
  };

  for (const file of initialReadFiles) {
    upsert(file, 100, "planner");
  }

  for (const file of writeTargetReads) {
    upsert(file, 95, "write-target");
  }

  for (const file of changedHintFiles) {
    upsert(file, 85, "changed-file");
  }

  for (const file of dependencyFiles) {
    upsert(file, 70, "dependency");
  }

  for (const match of vectorMatches) {
    upsert(match.path, 40 + Math.max(0, Math.min(40, match.score * 10)), "semantic");
  }

  return [...candidates.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.path.localeCompare(right.path);
  });
}

function computeExpandedContextLimit({
  rules,
  initialCount,
  writeTargetCount
}: {
  rules: RulesConfig;
  initialCount: number;
  writeTargetCount: number;
}): number {
  const base = Math.max(rules.max_files ?? 0, initialCount + writeTargetCount);
  const vectorBudget = Math.max(2, Math.min(6, rules.vector_search?.max_results ?? 4));
  const dependencyBudget = Math.min(4, Math.max(1, initialCount));
  return Math.max(base, 1) + vectorBudget + dependencyBudget;
}

async function collectChangedWorkingTreeFiles(
  repoRoot: string,
  rules: RulesConfig,
  logger?: Logger
): Promise<string[]> {
  try {
    const status = await runCommand({
      command: "git",
      args: ["status", "--porcelain", "--untracked-files=all"],
      cwd: repoRoot,
      timeoutMs: 30000
    });
    const changedFiles = parseGitStatusPaths(status.stdout)
      .map((filePath) => filePath.replace(/\\/g, "/").replace(/^\.\/+/, ""))
      .filter(Boolean);
    if (changedFiles.length === 0) {
      return [];
    }
    return await filterExistingSafeReadFiles(repoRoot, changedFiles, rules, logger, Math.min(changedFiles.length, 24));
  } catch {
    return [];
  }
}

export async function trimRankedCandidatesByBudget({
  repoRoot,
  rankedCandidates,
  maxExpandedFiles,
  maxContextBytes
}: {
  repoRoot: string;
  rankedCandidates: ContextSelectionCandidate[];
  maxExpandedFiles: number;
  maxContextBytes: number;
}): Promise<{ selectedPaths: string[]; trimmedPaths: string[]; trimmedSummaries: Array<{ path: string; reason: string }>; selectedBytes: number }> {
  if (rankedCandidates.length === 0) {
    return { selectedPaths: [], trimmedPaths: [], trimmedSummaries: [], selectedBytes: 0 };
  }

  const fileSizes = new Map<string, number>();
  for (const entry of rankedCandidates) {
    try {
      const stat = await fs.stat(resolveRepoPath(repoRoot, entry.path));
      fileSizes.set(entry.path, Math.max(stat.size, 1));
    } catch {
      fileSizes.set(entry.path, Number.POSITIVE_INFINITY);
    }
  }

  const pinned = rankedCandidates.filter((entry) => entry.sources.includes("planner") || entry.sources.includes("write-target"));
  const optional = rankedCandidates.filter((entry) => !pinned.includes(entry));
  const selected = new Set<string>();
  const trimmed: string[] = [];
  const trimmedSummaries: Array<{ path: string; reason: string }> = [];
  let totalBytes = 0;

  for (const entry of pinned) {
    if (selected.size >= maxExpandedFiles) {
      const reason = `exceeded max file count (${maxExpandedFiles})`;
      entry.exclusionReason = reason;
      trimmed.push(entry.path);
      trimmedSummaries.push({ path: entry.path, reason });
      continue;
    }
    selected.add(entry.path);
    totalBytes += fileSizes.get(entry.path) ?? 0;
  }

  const optionalByDensity = [...optional].sort((left, right) => {
    const leftSize = Math.max(fileSizes.get(left.path) ?? 1, 1);
    const rightSize = Math.max(fileSizes.get(right.path) ?? 1, 1);
    const leftDensity = left.score / Math.sqrt(leftSize);
    const rightDensity = right.score / Math.sqrt(rightSize);
    if (rightDensity !== leftDensity) {
      return rightDensity - leftDensity;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.path.localeCompare(right.path);
  });

  for (const entry of optionalByDensity) {
    if (selected.size >= maxExpandedFiles) {
      const reason = `exceeded max file count (${maxExpandedFiles})`;
      entry.exclusionReason = reason;
      trimmed.push(entry.path);
      trimmedSummaries.push({ path: entry.path, reason });
      continue;
    }

    const size = fileSizes.get(entry.path) ?? 0;
    if (selected.size > 0 && totalBytes + size > maxContextBytes) {
      const reason = `exceeded context budget (${maxContextBytes} bytes); file size ${size} would push total to ${totalBytes + size}`;
      entry.exclusionReason = reason;
      trimmed.push(entry.path);
      trimmedSummaries.push({ path: entry.path, reason });
      continue;
    }

    selected.add(entry.path);
    totalBytes += size;
  }

  const selectedPaths = rankedCandidates.map((entry) => entry.path).filter((path) => selected.has(path));
  const trimmedPaths = rankedCandidates.map((entry) => entry.path).filter((path) => !selected.has(path));
  return {
    selectedPaths,
    trimmedPaths: [...new Set(trimmedPaths.concat(trimmed))],
    trimmedSummaries,
    selectedBytes: totalBytes
  };
}

function parseGitStatusPaths(output: string): string[] {
  const files = new Set<string>();

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    const pathPart = line.slice(3).trim();
    if (!pathPart) {
      continue;
    }

    const normalized = pathPart.includes(" -> ") ? pathPart.split(" -> ").at(-1) ?? "" : pathPart;
    if (normalized) {
      files.add(normalized);
    }
  }

  return [...files];
}
