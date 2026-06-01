/**
 * Normalizes raw WorkItem data into a valid WorkItem object.
 * Handles missing fields and schema versioning.
 */
export function normalizeWorkItem(data) {
    if (!data) {
        throw new Error("Invalid WorkItem data: null or undefined");
    }
    const normalized = {
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
        stage: typeof data.stage === "string" ? data.stage : undefined,
        executionMode: typeof data.executionMode === "string" ? data.executionMode : undefined,
        workflowProfile: typeof data.workflowProfile === "string" ? data.workflowProfile : undefined,
        routingProfile: typeof data.routingProfile === "string" ? data.routingProfile : undefined,
        requestedBy: typeof data.requestedBy === "string" ? data.requestedBy : undefined,
        repo: data.repo && typeof data.repo === "object"
            ? {
                localPath: typeof data.repo.localPath === "string" ? data.repo.localPath : undefined,
                remote: typeof data.repo.remote === "string" ? data.repo.remote : undefined
            }
            : undefined,
        externalTask: data.externalTask,
        linkedRuns: Array.isArray(data.linkedRuns) ? data.linkedRuns : [],
        branch: data.branch,
        worktreePath: data.worktreePath,
        pullRequest: data.pullRequest,
        assessment: data.assessment,
        graph: data.graph,
        checklist: Array.isArray(data.checklist) ? data.checklist : [],
        ci: data.ci
    };
    return normalized;
}
