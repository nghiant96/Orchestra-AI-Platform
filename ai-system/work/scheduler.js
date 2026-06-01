const tierOrder = {
    docs: 0,
    config: 0,
    investigation: 0,
    test: 1,
    bugfix: 1,
    review: 1,
    refactor: 2,
    feature: 2,
};
function sortByTierDesc(items) {
    // Lower tier = cheaper model = execute first
    return [...items].sort((a, b) => {
        const tierA = a.assessment?.modelTier ?? tierOrder[a.type] ?? 2;
        const tierB = b.assessment?.modelTier ?? tierOrder[b.type] ?? 2;
        if (tierA !== tierB)
            return tierA - tierB;
        // Same tier: shorter dependency chains first
        const depsA = a.graph?.nodes.filter((n) => n.dependsOn.length > 0).length ?? 0;
        const depsB = b.graph?.nodes.filter((n) => n.dependsOn.length > 0).length ?? 0;
        return depsA - depsB;
    });
}
export function scheduleWorkItems(items, options = {}) {
    const ready = [];
    const blocked = [];
    const activePaths = new Map();
    // Sort by tier before scheduling (cheaper/less risky first)
    const sorted = sortByTierDesc(items);
    for (const item of sorted) {
        const conflicts = [];
        const pathKey = item.worktreePath || item.branch || item.id;
        const existing = activePaths.get(pathKey);
        // Path conflict: two items share same branch/worktree
        if (existing && existing !== item.id) {
            conflicts.push({ workItemId: existing, reason: "Shared branch or worktree path" });
        }
        // Already failed or cancelled
        if (item.status === "failed" || item.status === "cancelled") {
            conflicts.push({ workItemId: item.id, reason: `Work item status is ${item.status}` });
        }
        // Concurrency cap
        if (options.maxParallel != null && activePaths.size >= options.maxParallel) {
            conflicts.push({
                workItemId: item.id,
                reason: `Max parallel (${options.maxParallel}) reached`,
            });
        }
        if (conflicts.length > 0) {
            blocked.push({ workItem: item, conflicts });
        }
        else {
            ready.push(item);
            activePaths.set(pathKey, item.id);
        }
    }
    return { ready, blocked };
}
