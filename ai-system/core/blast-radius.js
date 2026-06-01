/**
 * Builds a deterministic blast-radius context for a set of changed files.
 */
export async function buildBlastRadiusContext({ repoRoot: _repoRoot, changedFiles, dependencyGraph, contracts = [], toolResults = [] }) {
    const affectedSet = new Set();
    const relatedTestsSet = new Set();
    const riskSignals = [];
    const limitations = [];
    // 1. Identify affected files using dependency graph
    if (dependencyGraph) {
        try {
            const related = await dependencyGraph.getRelatedFiles(changedFiles, 2);
            for (const file of related) {
                if (!changedFiles.includes(file)) {
                    if (isTestFile(file)) {
                        relatedTestsSet.add(file);
                    }
                    else {
                        affectedSet.add(file);
                    }
                }
            }
        }
        catch (error) {
            limitations.push(`Dependency analysis failed: ${error.message}`);
        }
    }
    else {
        limitations.push("Dependency graph not provided; skipping deep impact analysis.");
    }
    // 2. Identify related tests by naming convention if not already found
    for (const file of changedFiles) {
        const testFile = findTestFileByConvention(file);
        if (testFile) {
            // In a real repo we might want to check if it exists, but for now we'll just suggest it
            relatedTestsSet.add(testFile);
        }
    }
    // 3. Generate risk signals
    if (changedFiles.length > 10) {
        riskSignals.push({
            name: "large-change-set",
            severity: "medium",
            reason: `Task touches ${changedFiles.length} files, which is above the recommended threshold for a single PR.`
        });
    }
    const sensitiveFiles = changedFiles.filter(f => isSensitiveFile(f));
    if (sensitiveFiles.length > 0) {
        riskSignals.push({
            name: "sensitive-files-changed",
            severity: "high",
            reason: `Changes include sensitive files: ${sensitiveFiles.join(", ")}`
        });
    }
    const failedContracts = contracts.filter(c => c.status === "failed");
    if (failedContracts.length > 0) {
        riskSignals.push({
            name: "contract-failures",
            severity: "high",
            reason: `${failedContracts.length} task contract(s) failed validation.`
        });
    }
    const failedTools = toolResults.filter(r => !r.ok && !r.skipped);
    if (failedTools.length > 0) {
        riskSignals.push({
            name: "tool-failures",
            severity: "medium",
            reason: `${failedTools.length} tool(s) reported failures during verification.`
        });
    }
    return {
        changedFiles,
        affectedFiles: [...affectedSet].sort(),
        relatedTests: [...relatedTestsSet].sort(),
        riskSignals,
        confidence: {
            level: limitations.length === 0 ? "high" : "medium",
            limitations
        }
    };
}
function isTestFile(filePath) {
    return /test|spec|\.test\.|\.spec\./i.test(filePath);
}
function findTestFileByConvention(filePath) {
    if (isTestFile(filePath))
        return null;
    const ext = filePath.split(".").pop();
    if (!ext)
        return null;
    const base = filePath.slice(0, -(ext.length + 1));
    return `${base}.test.${ext}`;
}
function isSensitiveFile(filePath) {
    return /(\.env|secret|credential|permission|auth|config|\.ai-system\.json)/i.test(filePath);
}
