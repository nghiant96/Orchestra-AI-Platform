const BLOCKING = new Set(["high", "medium"]);
const VALID_SEVERITIES = new Set(["high", "medium", "low"]);

export function normalizeReviewResult(result) {
  const issues = Array.isArray(result?.issues) ? result.issues.map(normalizeIssue).filter(Boolean) : [];
  return {
    summary: typeof result?.summary === "string" ? result.summary : "",
    issues
  };
}

export function mergeIssues(reviewIssues, validationIssues) {
  const merged = [...validationIssues, ...reviewIssues].map(normalizeIssue).filter(Boolean);
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

export function hasBlockingIssues(issues) {
  return issues.some((issue) => BLOCKING.has(issue.severity));
}

export function summarizeIssueCounts(issues) {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 }
  );
}

export function validateCandidateFiles(files) {
  const issues = [];
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

    if (file.path.endsWith(".json")) {
      try {
        JSON.parse(file.content);
      } catch (error) {
        issues.push(validationIssue("high", "validation", file.path, `Generated JSON is invalid: ${error.message}`));
      }
    }
  }

  return issues;
}

export function buildDiffSummaries(originalFiles, candidateFiles) {
  const originalByPath = new Map(originalFiles.map((file) => [file.path, file.content ?? ""]));

  return candidateFiles.map((file) => {
    const before = originalByPath.get(file.path) ?? "";
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

function normalizeIssue(issue) {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const severity = VALID_SEVERITIES.has(issue.severity) ? issue.severity : "medium";
  const category = typeof issue.category === "string" ? issue.category : "bug";
  const path = typeof issue.path === "string" ? issue.path : "";
  const description = typeof issue.description === "string" ? issue.description : "";
  const suggestedFix = typeof issue.suggestedFix === "string" ? issue.suggestedFix : "";

  if (!description) {
    return null;
  }

  return { severity, category, path, description, suggestedFix };
}

function validationIssue(severity, category, path, description) {
  return { severity, category, path, description, suggestedFix: "" };
}

function estimateChangedLines(beforeLines, afterLines) {
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  let changed = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if ((beforeLines[index] ?? "") !== (afterLines[index] ?? "")) {
      changed += 1;
    }
  }

  return changed;
}
