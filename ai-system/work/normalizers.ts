import type { WorkItem } from "./work-item.js";

/**
 * Normalizes raw WorkItem data into a valid WorkItem object.
 * Handles missing fields and schema versioning.
 */
export function normalizeWorkItem(data: any): WorkItem {
  if (!data) {
    throw new Error("Invalid WorkItem data: null or undefined");
  }

  const normalized: WorkItem = {
    schemaVersion: 1,
    id: String(data.id || ""),
    projectId: String(data.projectId || ""),
    title: String(data.title || "Untitled Work Item"),
    description: String(data.description || ""),
    source: data.source || "manual",
    type: data.type || "feature",
    status: data.status || "created",
    risk: data.risk || "low",
    expectedOutput: data.expectedOutput || "patch",
    createdBy: String(data.createdBy || "system"),
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
    externalTask: data.externalTask,
    linkedRuns: Array.isArray(data.linkedRuns) ? data.linkedRuns : [],
    branch: data.branch,
    worktreePath: data.worktreePath,
    pullRequest: data.pullRequest,
    assessment: data.assessment,
    graph: data.graph,
    checklist: Array.isArray(data.checklist) ? data.checklist : []
  };

  return normalized;
}
