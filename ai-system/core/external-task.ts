import type { ExternalTaskRef, ExternalTaskKind } from "../types.js";

/**
 * Parses a string (likely a URL) into an ExternalTaskRef if it matches supported patterns.
 * 
 * Supported formats:
 * - https://github.com/owner/repo/issues/123
 * - https://github.com/owner/repo/pull/456
 */
export function parseExternalTask(input: string): ExternalTaskRef | null {
  try {
    const trimmed = input.trim();
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    // Expected: [owner, repo, "issues" | "pull", number]
    if (parts.length !== 4) {
      return null;
    }

    const [owner, repo, type, numberStr] = parts;
    if (!owner || !repo || !numberStr) {
      return null;
    }
    
    // Reject unsupported paths
    if (type !== "issues" && type !== "pull") {
      return null;
    }

    if (!/^[1-9]\d*$/.test(numberStr)) {
      return null;
    }
    const number = Number(numberStr);

    const kind: ExternalTaskKind = type === "issues" ? "issue" : "pull_request";

    return {
      provider: "github",
      kind,
      url: trimmed,
      owner,
      repo,
      number,
      sourceText: input
    };
  } catch {
    // Not a valid URL
    return null;
  }
}

/**
 * Normalizes an ExternalTaskRef into a task prompt.
 */
export function normalizeExternalTaskToPrompt(ref: ExternalTaskRef): string {
  if (ref.kind === "issue") {
    return `Implement changes for GitHub Issue: ${ref.url}
    
Repo: ${ref.owner}/${ref.repo}
Issue Number: #${ref.number}

Instructions:
1. Inspect the local code and current checkout to understand the context.
2. Identify all files that need to be changed or created.
3. Define a clear test plan to verify the implementation.
4. Propose the implementation steps.`;
  }
  
  if (ref.kind === "pull_request") {
    return `Perform a staff-level review for GitHub PR: ${ref.url}

Repo: ${ref.owner}/${ref.repo}
PR Number: #${ref.number}

Review Requirements:
1. Findings First: Lead with concrete technical observations.
2. Severity/Risk Ordering: Prioritize blocking issues and high-risk behavioral gaps.
3. File/Line Grounding: Reference specific files and line numbers whenever local diff context provides them.
4. Identify Open Questions: Highlight areas needing clarification.
5. Identify Test Gaps: Point out missing test coverage for changed logic.
6. Summary last: Provide a concise overall assessment at the end.

Note: Inspect local git status and diff to ground your findings. State any assumptions about the local branch matching the remote PR.`;
  }

  return `External task: ${ref.url}`;
}
