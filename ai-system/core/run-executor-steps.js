import { readContextFiles } from "./context.js";
import { persistContextArtifacts } from "./artifacts.js";
import { safelySearchMemory } from "./run-executor-utils.js";
export async function loadImplementationMemoryContext(memory, task, plan, memoryStats, logger) {
    const implementationMemories = await safelySearchMemory(memory, { task, stage: "implementation", plan }, logger);
    memoryStats.implementationMatches = implementationMemories.length;
    return memory.formatForPrompt(implementationMemories, "implementation");
}
export async function readAndPersistContext(repoRoot, plan, rules, artifactState, logger) {
    const startedAt = Date.now();
    logger.step(`Reading ${plan.readFiles.length} file(s) of context`);
    const { contexts: contextFiles, skippedFiles } = await readContextFiles(repoRoot, plan.readFiles, rules, logger);
    const durationMs = Date.now() - startedAt;
    await persistContextArtifacts(artifactState, {
        readFiles: plan.readFiles,
        skippedFiles,
        contexts: contextFiles,
        durationMs
    }, logger);
    return { contextFiles, skippedFiles, durationMs };
}
export async function generateCandidate({ iteration, task, plan, currentResult, latestReviewSummary, acceptedIssues, repoRoot, implementationMemoryContext, contextFiles, runtime }) {
    if (iteration === 1 && !currentResult) {
        return runtime.generator.generateCode(task, plan, contextFiles, repoRoot, implementationMemoryContext);
    }
    if (!currentResult) {
        throw new Error("Missing generation result before fixer iteration.");
    }
    return runtime.fixer.fixCode(task, plan, currentResult.files, latestReviewSummary, acceptedIssues, repoRoot, implementationMemoryContext);
}
