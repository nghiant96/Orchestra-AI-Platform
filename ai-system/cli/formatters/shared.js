export function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 1000) {
        return `${Math.max(0, Math.round(durationMs || 0))}ms`;
    }
    const seconds = durationMs / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}
export function formatExecutionBudget(budget) {
    const parts = [
        `duration=${formatDuration(budget.totalDurationMs)}${budget.maxDurationMs ? `/${formatDuration(budget.maxDurationMs)}` : ""}`,
        `cost=${budget.totalCostUnits.toFixed(2)}${budget.maxCostUnits ? `/${budget.maxCostUnits.toFixed(2)}` : ""}`
    ];
    if (budget.exceeded) {
        parts.push(`exceeded=${budget.exceeded}`);
    }
    return parts.join(", ");
}
export function summarizeToolResults(results) {
    return results.reduce((counts, result) => {
        if (result.skipped) {
            counts.skipped += 1;
        }
        else if (result.ok) {
            counts.passed += 1;
        }
        else {
            counts.failed += 1;
        }
        return counts;
    }, { passed: 0, failed: 0, skipped: 0 });
}
export function summarizeIssueCountsFromIssues(issues) {
    return issues.reduce((counts, issue) => {
        counts[issue.severity] += 1;
        return counts;
    }, { high: 0, medium: 0, low: 0 });
}
export function formatDisplayJson(value) {
    return JSON.stringify(sanitizeForDisplay(value), null, 2);
}
export function sanitizeForDisplay(value) {
    if (typeof value === "string") {
        return maskSecrets(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForDisplay(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
            key,
            sanitizeForDisplay(entryValue)
        ]));
    }
    return value;
}
export function maskSecrets(value) {
    if (!value)
        return value;
    if (/^work-[A-Za-z0-9-]+$/.test(value)) {
        return value;
    }
    // A simple mask for strings that look like keys
    if (value.length > 20 && (value.includes("sk-") || /^[A-Za-z0-9-_]{30,}$/.test(value))) {
        return `${value.slice(0, 4)}...${value.slice(-4)}`;
    }
    return value;
}
export function formatCost(units) {
    if (units === 0)
        return "0.00 units";
    if (units < 0.01)
        return "${(units * 1000).toFixed(2)}mU";
    return "${units.toFixed(2)} units";
}
