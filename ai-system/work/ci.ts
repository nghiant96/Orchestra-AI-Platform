import type { WorkItem } from "./work-item.js";

export interface CiWatchResult {
  status: "passing" | "failing" | "unknown";
  summary: string;
  failingChecks: string[];
  repairNeeded: boolean;
}

export function watchCiForWorkItem(workItem: WorkItem): CiWatchResult {
  const failingChecks = workItem.ci?.failingChecks ?? [];
  const status = workItem.ci?.status ?? (failingChecks.length > 0 ? "failing" : "unknown");
  return {
    status,
    summary: workItem.ci?.summary ?? (status === "passing" ? "CI passing" : status === "failing" ? "CI failing" : "CI not checked"),
    failingChecks,
    repairNeeded: status === "failing" && (workItem.ci?.repairAttempts ?? 0) < (workItem.ci?.maxRepairAttempts ?? 2)
  };
}

export function proposeCiRepairTask(workItem: WorkItem, report: CiWatchResult): string {
  const checks = report.failingChecks.length > 0 ? `Failing checks: ${report.failingChecks.join(", ")}.` : "No failing checks were captured.";
  return [
    `Fix CI for work item ${workItem.id}: ${workItem.title}.`,
    checks,
    "Keep the fix on the same work item branch.",
    "Stop if attempts or budget are exhausted."
  ].join(" ");
}
