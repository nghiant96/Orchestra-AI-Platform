import type { DiffSummary, GeneratedFile, ReviewIssue, ReviewResult } from "../types.js";

const BLOCKING = new Set(["high", "medium"]);
const VALID_SEVERITIES = new Set(["high", "medium", "low"]);

export function normalizeReviewResult(result: unknown): ReviewResult {
  const issues = Array.isArray((result as ReviewResult | undefined)?.issues)
    ? (result as ReviewResult).issues.map(normalizeIssue).filter(Boolean) as ReviewIssue[]
    : [];
  return {
    summary: typeof (result as ReviewResult | undefined)?.summary === "string" ? (result as ReviewResult).summary : "",
    issues
  };
}

export function mergeIssues(reviewIssues: ReviewIssue[], validationIssues: ReviewIssue[]): ReviewIssue[] {
  const merged = [...validationIssues, ...reviewIssues].map(normalizeIssue).filter(Boolean) as ReviewIssue[];
  const seen = new Set();

  return merged.filter((issue) => {
    const key = `${issue.severity}|${issue.category}|${issue.path}|${issue.description}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function hasBlockingIssues(issues: ReviewIssue[]): boolean {
  return issues.some((issue) => BLOCKING.has(issue.severity));
}

export function summarizeIssueCounts(issues: ReviewIssue[]): Record<"high" | "medium" | "low", number> {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 }
  );
}

export function validateCandidateFiles(files: GeneratedFile[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const seen = new Set();

  for (const file of files) {
    if (!file || typeof file.path !== "string") {
      issues.push(validationIssue("high", "validation", "", "Generated file is missing a valid path."));
      continue;
    }

    if (seen.has(file.path)) {
      issues.push(validationIssue("high", "validation", file.path, "Generator returned the same file path more than once."));
      continue;
    }
    seen.add(file.path);

    if (typeof file.content !== "string") {
      issues.push(validationIssue("high", "validation", file.path, "Generated file content is not a string."));
      continue;
    }

  }

  return issues;
}

export function buildDiffSummaries(
  originalFiles: Array<{ path: string; content?: string | null }>,
  candidateFiles: GeneratedFile[]
): DiffSummary[] {
  const originalByPath = new Map(originalFiles.map((file) => [file.path, file.content ?? ""]));

  return candidateFiles.map((file) => {
    const before = String(originalByPath.get(file.path) ?? "");
    const after = file.content ?? "";
    const beforeLines = before === "" ? [] : before.split(/\r?\n/);
    const afterLines = after === "" ? [] : after.split(/\r?\n/);

    return {
      path: file.path,
      beforeLineCount: beforeLines.length,
      afterLineCount: afterLines.length,
      addedLines: Math.max(afterLines.length - beforeLines.length, 0),
      removedLines: Math.max(beforeLines.length - afterLines.length, 0),
      changedLineEstimate: estimateChangedLines(beforeLines, afterLines)
    };
  });
}

function normalizeIssue(issue: unknown): ReviewIssue | null {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const candidate = issue as Partial<ReviewIssue>;
  const severity = VALID_SEVERITIES.has(String(candidate.severity))
    ? (candidate.severity as ReviewIssue["severity"])
    : "medium";
  const category = typeof candidate.category === "string" ? candidate.category : "bug";
  const path = typeof candidate.path === "string" ? candidate.path : "";
  const description = typeof candidate.description === "string" ? candidate.description : "";
  const suggestedFix = typeof candidate.suggestedFix === "string" ? candidate.suggestedFix : "";

  if (!description) {
    return null;
  }

  return { severity, category, path, description, suggestedFix };
}

function validationIssue(
  severity: ReviewIssue["severity"],
  category: string,
  path: string,
  description: string
): ReviewIssue {
  return { severity, category, path, description, suggestedFix: "" };
}

function estimateChangedLines(beforeLines: string[], afterLines: string[]): number {
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  let changed = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if ((beforeLines[index] ?? "") !== (afterLines[index] ?? "")) {
      changed += 1;
    }
  }

  return changed;
}
