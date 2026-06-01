import { normalizeTask } from "./base.js";
export class TestsExtractor {
    domain = "tests";
    detectRequirements(task) {
        const requirements = [];
        const normalized = normalizeTask(task);
        if (touchesRiskyAreaNeedingTests(normalized)) {
            requirements.push({
                id: "risky-change-requires-focused-tests",
                note: "Requirement: risky changes must include or run focused tests for the affected behavior.",
                description: "Risky changes require focused test coverage.",
                suggestedFix: "Add or run targeted tests covering auth, payment, migration, queue lifecycle, or config behavior touched by the task.",
                severity: "high",
                checkStrategy: "tool",
                targetPaths: ["tests"]
            });
        }
        return requirements;
    }
    validateCoverage(_contracts, _files) {
        return [];
    }
}
function touchesRiskyAreaNeedingTests(normalized) {
    return /(auth|authentication|authorization|login|payment|billing|migration|queue|approval|config|server|orchestrator)/.test(normalized)
        && /(fix|change|update|sửa|chỉnh|implement|add|thêm|xử lý)/.test(normalized);
}
