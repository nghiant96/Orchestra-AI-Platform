export function requirementIssue(path, description, suggestedFix) {
    return {
        severity: "medium",
        category: "requirement",
        path,
        description,
        suggestedFix
    };
}
export function normalizeTask(value) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}
