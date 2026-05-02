import type { WorkItem } from "./work-item.js";

export interface WorkConflict {
  workItemId: string;
  reason: string;
}

export interface SchedulerPlan {
  ready: WorkItem[];
  blocked: Array<{ workItem: WorkItem; conflicts: WorkConflict[] }>;
}

export function scheduleWorkItems(items: WorkItem[]): SchedulerPlan {
  const ready: WorkItem[] = [];
  const blocked: Array<{ workItem: WorkItem; conflicts: WorkConflict[] }> = [];
  const activePaths = new Map<string, string>();

  for (const item of items) {
    const conflicts: WorkConflict[] = [];
    const pathKey = item.worktreePath || item.branch || item.id;
    const existing = activePaths.get(pathKey);
    if (existing && existing !== item.id) {
      conflicts.push({ workItemId: existing, reason: "Shared branch or worktree path" });
    }
    if (item.status === "failed" || item.status === "cancelled") {
      conflicts.push({ workItemId: item.id, reason: `Work item status is ${item.status}` });
    }
    if (conflicts.length > 0) {
      blocked.push({ workItem: item, conflicts });
    } else {
      ready.push(item);
      activePaths.set(pathKey, item.id);
    }
  }

  return { ready, blocked };
}
