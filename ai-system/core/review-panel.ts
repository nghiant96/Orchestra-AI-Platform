import type { ReviewIssue, ReviewResult } from "../types.js";

/**
 * A single perspective on the same change.
 *
 * Redundancy is not the point — running one reviewer five times mostly
 * resurfaces the same findings. Diversity is: each lens is told to look for a
 * different class of defect, so the panel covers failure modes a single pass
 * misses.
 */
export interface ReviewLens {
  id: string;
  instruction: string;
}

export const DEFAULT_REVIEW_LENSES: ReviewLens[] = [
  {
    id: "correctness",
    instruction:
      "Review for correctness only. Look for logic errors, wrong conditions, off-by-one mistakes, unhandled null or undefined, incorrect error handling, and behaviour that contradicts the stated plan. Ignore style."
  },
  {
    id: "security",
    instruction:
      "Review for security only. Look for injection, path traversal, unsafe deserialisation, missing authentication or authorisation checks, secrets in code or logs, and unsafe defaults. Ignore style and performance."
  },
  {
    id: "regression",
    instruction:
      "Review for regression risk only. Look for changed behaviour that existing callers depend on, altered public signatures, removed guards, broken invariants, and edge cases the change stops handling. Ignore new-feature quality."
  },
  {
    id: "tests",
    instruction:
      "Review test coverage only. Look for new behaviour with no test, assertions that cannot fail, tests that would pass against a broken implementation, and missing failure-path coverage. Ignore production-code style."
  },
  {
    id: "maintainability",
    instruction:
      "Review maintainability only. Look for duplicated logic, misplaced responsibility, names that mislead, dead code, and abstractions that will be hard to change. Do not report cosmetic formatting."
  }
];

export interface ReviewPanelConfig {
  enabled: boolean;
  /** How many lenses must independently raise a finding before it can block. */
  quorum: number;
  lenses: ReviewLens[];
}

export const DEFAULT_REVIEW_PANEL_QUORUM = 2;

/** One lens's outcome. A lens that fails is recorded, not fatal. */
export interface PanelistOutcome {
  lensId: string;
  ok: boolean;
  issueCount: number;
  error?: string;
}

export interface ReviewPanelOutcome {
  result: ReviewResult;
  panelists: PanelistOutcome[];
  quorum: number;
}

/** Resolve panel settings from rules, defaulting to off. */
export function resolveReviewPanelConfig(raw: unknown): ReviewPanelConfig {
  const config = (raw ?? {}) as {
    enabled?: unknown;
    quorum?: unknown;
    lenses?: unknown;
  };

  const requested = Array.isArray(config.lenses)
    ? config.lenses.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];
  const lenses = requested.length
    ? DEFAULT_REVIEW_LENSES.filter((lens) => requested.includes(lens.id))
    : DEFAULT_REVIEW_LENSES;

  const parsedQuorum = Number(config.quorum);
  const quorum = Number.isInteger(parsedQuorum) && parsedQuorum > 0
    ? parsedQuorum
    : DEFAULT_REVIEW_PANEL_QUORUM;

  return {
    enabled: config.enabled === true && lenses.length > 0,
    // A quorum larger than the panel could never be met, which would silently
    // downgrade every finding to advisory.
    quorum: Math.min(quorum, Math.max(1, lenses.length)),
    lenses
  };
}

const SEVERITY_RANK: Record<ReviewIssue["severity"], number> = { low: 0, medium: 1, high: 2 };

/** Findings within a few lines of each other are treated as the same defect. */
const LINE_PROXIMITY = 3;

/**
 * Run every lens against the same change and merge the findings.
 *
 * Lenses run concurrently, so the panel costs one reviewer's wall clock rather
 * than N. A lens that throws is dropped from the panel and reported; the run
 * only fails if every lens fails, because half a panel still beats none.
 */
export async function runReviewPanel(
  lenses: ReviewLens[],
  quorum: number,
  reviewWithLens: (lens: ReviewLens) => Promise<ReviewResult>
): Promise<ReviewPanelOutcome> {
  if (lenses.length === 0) {
    throw new Error("Review panel needs at least one lens");
  }

  const settled = await Promise.allSettled(lenses.map((lens) => reviewWithLens(lens)));

  const panelists: PanelistOutcome[] = [];
  const perLens: Array<{ lens: ReviewLens; result: ReviewResult }> = [];

  for (const [index, outcome] of settled.entries()) {
    const lens = lenses[index]!;
    if (outcome.status === "fulfilled") {
      perLens.push({ lens, result: outcome.value });
      panelists.push({ lensId: lens.id, ok: true, issueCount: outcome.value.issues?.length ?? 0 });
    } else {
      panelists.push({
        lensId: lens.id,
        ok: false,
        issueCount: 0,
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      });
    }
  }

  if (perLens.length === 0) {
    const reasons = panelists.map((panelist) => `${panelist.lensId}: ${panelist.error}`).join("; ");
    throw new Error(`Every review lens failed (${reasons})`);
  }

  // The quorum cannot exceed the number of lenses that actually answered, or a
  // partly failed panel would downgrade findings it should have blocked on.
  const effectiveQuorum = Math.min(quorum, perLens.length);

  return {
    result: mergeReviews(perLens, effectiveQuorum),
    panelists,
    quorum: effectiveQuorum
  };
}

interface IssueGroup {
  issue: ReviewIssue;
  lensIds: Set<string>;
  highestSeverity: ReviewIssue["severity"];
}

function mergeReviews(
  perLens: Array<{ lens: ReviewLens; result: ReviewResult }>,
  quorum: number
): ReviewResult {
  const groups: IssueGroup[] = [];

  for (const { lens, result } of perLens) {
    for (const issue of result.issues ?? []) {
      const existing = groups.find((group) => isSameDefect(group.issue, issue));
      if (existing) {
        existing.lensIds.add(lens.id);
        if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[existing.highestSeverity]) {
          existing.highestSeverity = issue.severity;
          // Keep the description from the lens that rated it most serious.
          existing.issue = { ...issue };
        }
        continue;
      }
      groups.push({ issue: { ...issue }, lensIds: new Set([lens.id]), highestSeverity: issue.severity });
    }
  }

  const issues: ReviewIssue[] = groups
    .map((group) => {
      const agreement = group.lensIds.size;
      const met = agreement >= quorum;
      const lensList = [...group.lensIds].sort().join(", ");
      return {
        ...group.issue,
        // Below quorum the finding is kept but cannot block. One lens should not
        // be able to stall the pipeline on its own, and discarding the finding
        // outright would waste the very diversity the panel exists for.
        severity: met ? group.highestSeverity : ("low" as const),
        category: group.issue.category,
        description: met
          ? `${group.issue.description} [panel: ${agreement}/${perLens.length} agree — ${lensList}]`
          : `${group.issue.description} [panel: advisory, only ${agreement}/${perLens.length} raised this — ${lensList}]`,
        agreement: { count: agreement, lenses: [...group.lensIds].sort(), quorumMet: met }
      } satisfies ReviewIssue;
    })
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]);

  const blocking = issues.filter((issue) => issue.severity !== "low").length;
  const summary = [
    `Review panel of ${perLens.length} lens(es) (${perLens.map((entry) => entry.lens.id).join(", ")}), quorum ${quorum}.`,
    `${blocking} finding(s) met quorum; ${issues.length - blocking} advisory.`,
    ...perLens.map((entry) => `[${entry.lens.id}] ${entry.result.summary}`)
  ].join("\n");

  const missingTests = perLens.flatMap((entry) => entry.result.missingTests ?? []);

  return {
    summary,
    issues,
    ...(missingTests.length > 0 ? { missingTests } : {})
  };
}

/**
 * Whether two findings describe the same defect.
 *
 * This is a heuristic: different lenses word things differently, so matching
 * relies on location and category rather than text. It errs toward keeping
 * findings separate — over-merging would hide a real second defect, while
 * under-merging only costs an extra advisory line.
 */
function isSameDefect(left: ReviewIssue, right: ReviewIssue): boolean {
  if ((left.path ?? "") !== (right.path ?? "")) return false;
  if (normalizeCategory(left.category) !== normalizeCategory(right.category)) return false;

  const leftLine = left.line;
  const rightLine = right.line;
  if (leftLine == null || rightLine == null) {
    return leftLine == null && rightLine == null;
  }
  return Math.abs(leftLine - rightLine) <= LINE_PROXIMITY;
}

function normalizeCategory(category: string): string {
  return String(category ?? "").trim().toLowerCase();
}
