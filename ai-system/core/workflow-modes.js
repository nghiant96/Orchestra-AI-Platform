export function applyWorkflowModeDefaults(mode, explicit = {}) {
    const defaults = workflowModeDefaults(mode);
    return {
        dryRun: explicit.dryRun ?? defaults.dryRun,
        interactive: explicit.interactive ?? defaults.interactive,
        pauseAfterPlan: explicit.pauseAfterPlan ?? defaults.pauseAfterPlan,
        pauseAfterGenerate: explicit.pauseAfterGenerate ?? defaults.pauseAfterGenerate
    };
}
export function workflowModeDefaults(mode) {
    switch (mode) {
        case "implement":
            return {
                dryRun: false,
                interactive: false,
                pauseAfterPlan: false,
                pauseAfterGenerate: false
            };
        case "review":
            return {
                dryRun: true,
                interactive: true,
                pauseAfterPlan: false,
                pauseAfterGenerate: true
            };
        case "fix":
            return {
                dryRun: false,
                interactive: true,
                pauseAfterPlan: false,
                pauseAfterGenerate: false
            };
        case "refactor":
            return {
                dryRun: true,
                interactive: true,
                pauseAfterPlan: true,
                pauseAfterGenerate: false
            };
        case "standard":
        default:
            return {
                dryRun: false,
                interactive: false,
                pauseAfterPlan: false,
                pauseAfterGenerate: false
            };
    }
}
