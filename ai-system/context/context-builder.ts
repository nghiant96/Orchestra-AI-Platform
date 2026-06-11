import fs from "node:fs/promises";
import path from "node:path";
import type { WorkerRepoConventions, WorkerContextPack } from "../worker/context-pack.js";
import { normalizeWorkerContextPack, savePreContextPack } from "../worker/context-pack.js";
import { scanRepoConventions } from "../worker/repo-convention-scanner.js";
import { buildMemoryNamespace } from "../memory/memory-namespace.js";
import { createNoopSemanticContextProvider, type SemanticContextProvider } from "./semantic-context-provider.js";
import { runCommand } from "../utils/api.js";

export interface ContextBuilderInput {
  jobId: string;
  task: string;
  repoRoot: string;
  artifactDir: string;
}

export interface ContextCandidate {
  path: string;
  reason: string;
  source: "vector" | "ripgrep" | "git" | "convention" | "memory";
  score: number;
}

export interface BuiltContext {
  candidates: ContextCandidate[];
  preContextPack: WorkerContextPack;
}

export interface ContextBuilderOptions {
  repoConventions?: Awaited<ReturnType<typeof scanRepoConventions>>;
  semanticProvider?: SemanticContextProvider;
  candidateLimit?: number;
}

export async function buildContext(
  input: ContextBuilderInput,
  options: ContextBuilderOptions = {}
): Promise<BuiltContext> {
  const task = input.task.trim();
  const repoConventions = options.repoConventions ?? await scanRepoConventions(input.repoRoot);
  const semanticProvider = options.semanticProvider ?? createNoopSemanticContextProvider();
  const namespace = await buildMemoryNamespace(input.repoRoot);
  const ripgrepCandidates = await searchRipgrepCandidates({ task, repoRoot: input.repoRoot });
  const conventionCandidates = buildConventionCandidates(repoConventions);
  const semanticCandidates = await semanticProvider.search({
    query: task,
    repoRoot: input.repoRoot,
    namespace,
    limit: options.candidateLimit ?? 6
  });

  const candidates = dedupeAndRankCandidates([
    ...ripgrepCandidates,
    ...conventionCandidates,
    ...semanticCandidates.map((candidate) => ({ ...candidate, source: "vector" as const }))
  ]).slice(0, options.candidateLimit ?? 8);

  const preContextPack = normalizeWorkerContextPack({
    jobId: input.jobId,
    task,
    generatedAt: new Date().toISOString(),
    summary: buildPreContextSummary(task, candidates),
    relevantFiles: candidates.map((candidate) => ({
      path: candidate.path,
      reason: candidate.reason,
      status: "proposed" as const,
      role: "unknown" as const
    })),
    allowedDiffBoundary: buildAllowedDiffBoundary(candidates),
    doNotTouch: [],
    conventions: conventionsToRepoConventions(repoConventions),
    implementationPlan: buildImplementationPlan(task, candidates),
    verificationCommands: buildVerificationCommands(task),
    assumptions: [],
    missingContextWarnings: candidates.length === 0
      ? ["No strong deterministic context candidates were found."]
      : [],
    confidence: candidates.length > 0 ? "medium" : "low"
  }, { jobId: input.jobId, task });

  await savePreContextPack(input.artifactDir, preContextPack);

  return {
    candidates,
    preContextPack
  };
}

async function searchRipgrepCandidates(input: { task: string; repoRoot: string }): Promise<ContextCandidate[]> {
  const keywords = extractTaskKeywords(input.task);
  if (keywords.length === 0) {
    return [];
  }

  const rgResult = await tryRipgrepSearch(input.repoRoot, keywords);
  if (rgResult.length > 0) {
    return rgResult;
  }

  return scanFilesForKeywords(input.repoRoot, keywords);
}

async function tryRipgrepSearch(repoRoot: string, keywords: string[]): Promise<ContextCandidate[]> {
  try {
    const result = await runCommand({
      command: "rg",
      args: [
        "-n",
        "-i",
        "--no-heading",
        "--hidden",
        "--glob",
        "!**/node_modules/**",
        "--glob",
        "!**/dist/**",
        "--glob",
        "!**/build/**",
        "--glob",
        "!**/coverage/**",
        "--glob",
        "!**/.ai-system-server/**",
        "--glob",
        "!**/.ai-system-artifacts/**",
        "--glob",
        "!**/.ai-system-memory/**",
        "--glob",
        "!**/.ai-system-vector/**",
        "--glob",
        "!**/.orchestra/**",
        "--glob",
        "!**/.git/**",
        keywords.map(escapeRipgrepPattern).join("|")
      ],
      cwd: repoRoot,
      timeoutMs: 15000
    });
    return rankSearchOutput(result.stdout, keywords, "ripgrep");
  } catch {
    return [];
  }
}

async function scanFilesForKeywords(repoRoot: string, keywords: string[]): Promise<ContextCandidate[]> {
  const files = await listRepositoryFiles(repoRoot);
  const candidates: ContextCandidate[] = [];
  for (const filePath of files) {
    const content = await readUtf8File(path.join(repoRoot, filePath));
    if (!content) continue;
    const hits = countKeywordHits(content, keywords);
    if (hits > 0) {
      candidates.push({
        path: filePath,
        reason: `Matches task keywords: ${keywords.filter((keyword) => content.toLowerCase().includes(keyword)).join(", ")}`,
        source: "git",
        score: hits
      });
    }
  }
  return candidates;
}

function rankSearchOutput(stdout: string, keywords: string[], source: ContextCandidate["source"]): ContextCandidate[] {
  const byFile = new Map<string, { hits: number; lines: Set<number> }>();
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const [filePath, lineNumber, ...rest] = line.split(":");
    if (!filePath || rest.length === 0) continue;
    const entry = byFile.get(filePath) ?? { hits: 0, lines: new Set<number>() };
    entry.hits += 1;
    const parsedLine = Number(lineNumber);
    if (Number.isFinite(parsedLine)) entry.lines.add(parsedLine);
    byFile.set(filePath, entry);
  }

  return [...byFile.entries()]
    .map(([filePath, entry]) => ({
      path: filePath,
      reason: `Matches task keywords: ${keywords.join(", ")}`,
      source,
      score: entry.hits + entry.lines.size / 10
    }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

function dedupeAndRankCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
  const byPath = new Map<string, ContextCandidate>();
  for (const candidate of candidates) {
    const existing = byPath.get(candidate.path);
    if (!existing || candidate.score > existing.score) {
      byPath.set(candidate.path, candidate);
    }
  }
  return [...byPath.values()].sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

function buildConventionCandidates(repoConventions: Awaited<ReturnType<typeof scanRepoConventions>>): ContextCandidate[] {
  const sourcePatterns = [
    ...repoConventions.componentPatterns.map((stat) => ({ stat, source: "convention" as const })),
    ...repoConventions.hookPatterns.map((stat) => ({ stat, source: "convention" as const })),
    ...repoConventions.servicePatterns.map((stat) => ({ stat, source: "convention" as const })),
    ...repoConventions.apiClientPatterns.map((stat) => ({ stat, source: "convention" as const })),
    ...repoConventions.testPatterns.map((stat) => ({ stat, source: "convention" as const }))
  ];
  return sourcePatterns.flatMap(({ stat, source }) =>
    stat.examples.map((example, index) => ({
      path: example,
      reason: `Matches repo convention pattern ${stat.pattern}`,
      source,
      score: stat.count + stat.confidence - index * 0.1
    }))
  );
}

function conventionsToRepoConventions(
  repoConventions: Awaited<ReturnType<typeof scanRepoConventions>>
): WorkerRepoConventions {
  return {
    componentPatterns: repoConventions.componentPatterns.map((pattern) => pattern.pattern),
    hookPatterns: repoConventions.hookPatterns.map((pattern) => pattern.pattern),
    servicePatterns: repoConventions.servicePatterns.map((pattern) => pattern.pattern),
    apiClientPatterns: repoConventions.apiClientPatterns.map((pattern) => pattern.pattern),
    testPatterns: repoConventions.testPatterns.map((pattern) => pattern.pattern)
  };
}

function buildPreContextSummary(task: string, candidates: ContextCandidate[]): string {
  if (candidates.length === 0) {
    return `Pre-context draft for: ${task}\nNo strong candidates were found yet.`;
  }
  return [
    `Pre-context draft for: ${task}`,
    `Top candidates: ${candidates.slice(0, 5).map((candidate) => candidate.path).join(", ")}`
  ].join("\n");
}

function buildAllowedDiffBoundary(candidates: ContextCandidate[]): string[] {
  const prefixes = new Set<string>();
  for (const candidate of candidates.slice(0, 8)) {
    const firstSegment = candidate.path.split("/")[0];
    if (firstSegment && firstSegment !== candidate.path) {
      prefixes.add(`${firstSegment}/**`);
    }
  }
  return [...prefixes];
}

function buildImplementationPlan(task: string, candidates: ContextCandidate[]): string[] {
  const steps = [
    "Review the pre-context and confirm the likely surface area.",
    "Edit the highest-ranked files first.",
    "Run the minimum relevant verification checks."
  ];
  if (candidates.length === 0) {
    steps.unshift(`Investigate the repository layout for: ${task}`);
  }
  return steps;
}

function buildVerificationCommands(task: string): string[] {
  const commands: string[] = [];
  if (/\btest\b|\bverify\b|\bcheck\b/i.test(task)) {
    commands.push("pnpm test");
  }
  return commands;
}

function extractTaskKeywords(task: string): string[] {
  const stopWords = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "task", "update", "fix", "add", "make", "build", "create", "remove", "refactor"]);
  return [...new Set(task.toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? [])]
    .filter((word) => !stopWords.has(word));
}

function escapeRipgrepPattern(keyword: string): string {
  return keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countKeywordHits(content: string, keywords: string[]): number {
  const lowered = content.toLowerCase();
  return keywords.reduce((count, keyword) => count + (lowered.includes(keyword) ? 1 : 0), 0);
}

async function listRepositoryFiles(repoRoot: string): Promise<string[]> {
  try {
    const result = await runCommand({
      command: "git",
      args: ["ls-files", "--cached", "--others", "--exclude-standard"],
      cwd: repoRoot,
      timeoutMs: 15000
    });
    return result.stdout
      .split(/\r?\n/)
      .map((filePath) => filePath.trim().replace(/\\/g, "/"))
      .filter(Boolean)
      .filter((filePath) => !/^(node_modules|dist|build|coverage|\.git|\.ai-system-server|\.ai-system-artifacts|\.ai-system-memory|\.ai-system-vector|\.orchestra)(\/|$)/.test(filePath));
  } catch {
    return [];
  }
}

async function readUtf8File(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
