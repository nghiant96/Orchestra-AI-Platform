/**
 * Reconciles a planned test strategy with actual tool execution results.
 */
export function reconcileTestPlan(testPlan, toolResults) {
    if (!testPlan || !testPlan.items) {
        return [];
    }
    return testPlan.items.map((item) => {
        const matchedResult = findMatchingToolResult(item.command, toolResults);
        let status = "not_run";
        if (matchedResult) {
            if (matchedResult.skipped) {
                status = "skipped";
            }
            else {
                status = matchedResult.ok ? "passed" : "failed";
            }
        }
        return {
            name: item.purpose,
            description: item.purpose,
            severity: "required", // Planned items are treated as required for reconciliation
            status,
            targetPath: item.testFile,
            command: item.command
        };
    });
}
function findMatchingToolResult(command, toolResults) {
    // Try to find by exact command match first
    const exactMatch = toolResults.find(r => r.command === command || (r.command && command.includes(r.command)));
    if (exactMatch)
        return exactMatch;
    // Fallback: heuristic matching for common test runners
    if (command.includes("test")) {
        return toolResults.find(r => r.name === "test" || r.name.includes("test"));
    }
    return undefined;
}
