import type { WorkItem } from "./work-item.js";
import { runCommand } from "../utils/api.js";

export interface CiWatchResult {
  status: "passing" | "failing" | "unknown";
  summary: string;
  failingChecks: string[];
  repairNeeded: boolean;
}

export interface GhPrCheck {
  name: string;
  state: "SUCCESS" | "FAILURE" | "PENDING" | "SKIPPED" | "CANCELLED" | "EXPECTED";
  detailsUrl?: string;
}

export interface GhPrPollResult {
  status: "passing" | "failing" | "unknown";
  summary: string;
  failingChecks: string[];
  checks: GhPrCheck[];
}

/**
 * Poll GitHub PR checks using `gh pr checks` CLI.
 * Falls back gracefully if gh is not installed, not authenticated, or the PR doesn't exist.
 */
export async function pollGhPrChecks(
  repoRoot: string,
  prNumber: number
): Promise<GhPrPollResult | null> {
  try {
    // First verify gh is available and authenticated
    const { stdout: raw } = await runCommand({
      command: "gh",
      args: [
        "pr",
        "checks",
        "--repo",
        repoRoot,
        "--json",
        "name,state,detailsUrl",
        String(prNumber)
      ],
      cwd: repoRoot,
      timeoutMs: 30_000
    });

    if (!raw || raw.trim().length === 0) {
      return { status: "unknown", summary: "No CI checks found for PR.", failingChecks: [], checks: [] };
    }

    const checks: GhPrCheck[] = JSON.parse(raw);
    if (!Array.isArray(checks)) {
      return { status: "unknown", summary: `Unexpected gh pr checks output: ${raw.slice(0, 200)}`, failingChecks: [], checks: [] };
    }

    const failing = checks.filter((c) => c.state === "FAILURE");
    const pending = checks.filter((c) => c.state === "PENDING" || c.state === "EXPECTED");
    const cancelled = checks.filter((c) => c.state === "CANCELLED");
    const successful = checks.filter((c) => c.state === "SUCCESS" || c.state === "SKIPPED");

    const status: GhPrPollResult["status"] =
      failing.length > 0 || cancelled.length > 0
        ? "failing"
        : pending.length > 0
          ? "unknown"
          : successful.length > 0
            ? "passing"
            : "unknown";

    const summaryParts: string[] = [];
    if (successful.length > 0) summaryParts.push(`${successful.length} passing`);
    if (pending.length > 0) summaryParts.push(`${pending.length} pending`);
    if (failing.length > 0) summaryParts.push(`${failing.length} failing`);
    if (cancelled.length > 0) summaryParts.push(`${cancelled.length} cancelled`);

    return {
      status,
      summary: summaryParts.length > 0 ? `CI: ${summaryParts.join(", ")}` : "CI: no checks",
      failingChecks: failing.map((c) => c.name),
      checks
    };
  } catch (error) {
    const message = (error as Error).message ?? "";
    // Degrade gracefully: gh not installed, not authenticated, or network error
    if (
      message.includes("ENOENT") ||
      message.includes("command not found") ||
      message.includes("Failed to start gh") ||
      message.includes("auth") ||
      message.includes("401") ||
      message.includes("403") ||
      message.includes("Not Found")
    ) {
      return null; // caller should fall back to stored ci data
    }
    throw error; // unexpected error — rethrow
  }
}

/**
 * Watch CI for a work item. If the work item has a linked PR, polls GitHub
 * for real check statuses. Falls back to stored ci data when polling is unavailable.
 */
export async function watchCiForWorkItem(
  workItem: WorkItem,
  repoRoot: string
): Promise<CiWatchResult> {
  const prNumber = workItem.pullRequest?.number;

  // Attempt real polling if a PR exists
  if (prNumber != null) {
    const polled = await pollGhPrChecks(repoRoot, prNumber);
    if (polled) {
      return {
        status: polled.status,
        summary: polled.summary,
        failingChecks: polled.failingChecks,
        repairNeeded:
          polled.status === "failing" &&
          (workItem.ci?.repairAttempts ?? 0) < (workItem.ci?.maxRepairAttempts ?? 2)
      };
    }
  }

  // Fallback to stored ci data
  const failingChecks = workItem.ci?.failingChecks ?? [];
  const status = workItem.ci?.status ?? (failingChecks.length > 0 ? "failing" : "unknown");
  return {
    status,
    summary:
      workItem.ci?.summary ??
      (status === "passing"
        ? "CI passing (cached)"
        : status === "failing"
          ? "CI failing (cached)"
          : "CI not checked"),
    failingChecks,
    repairNeeded:
      status === "failing" &&
      (workItem.ci?.repairAttempts ?? 0) < (workItem.ci?.maxRepairAttempts ?? 2)
  };
}

/**
 * Sync a polled CI result back into partial WorkItem fields for persistence.
 * The caller should merge these fields and persist via WorkStore.save().
 */
export function syncCiToWorkItem(
  workItem: WorkItem,
  polled: GhPrPollResult
): Partial<WorkItem> {
  return {
    ci: {
      lastCheckedAt: new Date().toISOString(),
      status: polled.status,
      summary: polled.summary,
      failingChecks: polled.failingChecks,
      repairAttempts: workItem.ci?.repairAttempts ?? 0,
      maxRepairAttempts: workItem.ci?.maxRepairAttempts ?? 2
    }
  };
}

/**
 * Propose a repair task prompt for a failing CI work item.
 */
export function proposeCiRepairTask(workItem: WorkItem, report: CiWatchResult): string {
  const checks =
    report.failingChecks.length > 0
      ? `Failing checks: ${report.failingChecks.join(", ")}.`
      : "No failing checks were captured.";
  return [
    `Fix CI for work item ${workItem.id}: ${workItem.title}.`,
    checks,
    "Keep the fix on the same work item branch.",
    "Stop if attempts or budget are exhausted."
  ].join(" ");
}