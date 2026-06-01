import { UIExtractor } from "./extractors/ui.js";
import { APIExtractor } from "./extractors/api.js";
import { SecurityExtractor } from "./extractors/security.js";
import { TestsExtractor } from "./extractors/tests.js";
import { DataExtractor } from "./extractors/data.js";
import { ConfigExtractor } from "./extractors/config.js";
const EVENT_FEED_APP_PATH = "dashboard/src/App.tsx";
/**
 * Registry for task contract extractors.
 */
export class ExtractorRegistry {
    extractors = [];
    register(extractor) {
        // Avoid duplicates by domain
        if (this.extractors.some(e => e.domain === extractor.domain)) {
            return;
        }
        this.extractors.push(extractor);
    }
    getExtractors() {
        return [...this.extractors];
    }
}
// Global registry instance
export const globalRegistry = new ExtractorRegistry();
// Register default extractors
globalRegistry.register(new UIExtractor());
globalRegistry.register(new APIExtractor());
globalRegistry.register(new SecurityExtractor());
globalRegistry.register(new TestsExtractor());
globalRegistry.register(new DataExtractor());
globalRegistry.register(new ConfigExtractor());
export function enhancePlanForTaskRequirements(task, plan) {
    const requirements = detectTaskRequirements(task);
    if (requirements.length === 0) {
        return plan;
    }
    // Legacy specific behavior for Event Feed
    const isEventFeedFilter = /event\s+fe(?:e|a)d/.test(task.toLowerCase()) && task.toLowerCase().includes("filter");
    const readFiles = unique([
        ...plan.readFiles,
        ...(isEventFeedFilter && !plan.readFiles.includes(EVENT_FEED_APP_PATH) ? [EVENT_FEED_APP_PATH] : [])
    ]);
    const writeTargets = unique([
        ...plan.writeTargets,
        ...(isEventFeedFilter && readFiles.includes(EVENT_FEED_APP_PATH) ? [EVENT_FEED_APP_PATH] : [])
    ]);
    const notes = unique([...plan.notes, ...requirements.map((requirement) => requirement.note)]);
    const contracts = mergeContracts(plan.contracts ?? [], buildTaskContracts(task));
    return {
        ...plan,
        readFiles,
        writeTargets,
        notes,
        contracts
    };
}
export function validateTaskRequirementCoverage(task, files) {
    return validateTaskContractCoverage(buildTaskContracts(task), files);
}
export function buildTaskContracts(task) {
    return detectTaskRequirements(task).map((requirement) => ({
        id: requirement.id,
        description: requirement.description,
        severity: requirement.severity ?? "medium",
        status: "pending",
        checkStrategy: requirement.checkStrategy ?? "deterministic",
        targetPaths: requirement.targetPaths ?? [EVENT_FEED_APP_PATH],
        suggestedFix: requirement.suggestedFix,
        source: "deterministic"
    }));
}
export function validateTaskContractCoverage(contracts, files) {
    const allIssues = [];
    for (const extractor of globalRegistry.getExtractors()) {
        const issues = extractor.validateCoverage(contracts, files);
        allIssues.push(...issues);
    }
    return allIssues;
}
function detectTaskRequirements(task) {
    const allRequirements = [];
    for (const extractor of globalRegistry.getExtractors()) {
        const requirements = extractor.detectRequirements(task);
        allRequirements.push(...requirements);
    }
    return allRequirements;
}
function unique(items) {
    return [...new Set(items)];
}
function mergeContracts(existing, next) {
    const byId = new Map();
    for (const contract of existing) {
        byId.set(contract.id, { ...contract, source: contract.source ?? "llm" });
    }
    for (const contract of next) {
        // Deterministic contracts from 'next' will overwrite LLM suggested ones from 'existing'
        byId.set(contract.id, { ...contract, source: "deterministic" });
    }
    return [...byId.values()];
}
