export function resolveProjectRole(actor, rules, projectId) {
    const projectRole = projectId ? rules.auth?.project_role_mapping?.[projectId]?.[actor.id] : undefined;
    return projectRole ? { ...actor, role: projectRole } : actor;
}
export function canPerformAction(actor, rules, action, projectId) {
    const required = rules.auth?.action_permissions?.[action];
    const effectiveActor = resolveProjectRole(actor, rules, projectId);
    if (!required)
        return true;
    return roleRank(effectiveActor.role) >= roleRank(required);
}
function roleRank(role) {
    return role === "admin" ? 2 : role === "operator" ? 1 : 0;
}
