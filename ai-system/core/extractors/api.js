import { normalizeTask } from "./base.js";
export class APIExtractor {
    domain = "api";
    detectRequirements(task) {
        const requirements = [];
        const normalized = normalizeTask(task);
        if (asksToPreserveApiOrSchema(normalized)) {
            requirements.push({
                id: "api-schema-preserve-existing-contract",
                note: "Requirement: preserve existing API/schema shape unless the task explicitly asks for a breaking change.",
                description: "Existing API or schema output must remain backward compatible.",
                suggestedFix: "Update implementation behind the existing response shape or add an explicit migration/test for any schema change.",
                severity: "high",
                targetPaths: ["ai-system", "dashboard/src"]
            });
        }
        return requirements;
    }
    validateCoverage(_contracts, _files) {
        // Deterministic validation for API schema preservation is hard without a parser.
        // Usually handled by tests or manual review.
        return [];
    }
}
function asksToPreserveApiOrSchema(normalized) {
    return /(api|schema|response|payload|contract|database|db|migration)/.test(normalized)
        && /(preserve|compatible|compatibility|không đổi|giu nguyen|giữ nguyên|backward)/.test(normalized);
}
