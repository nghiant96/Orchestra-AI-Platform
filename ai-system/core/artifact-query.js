import fs from "node:fs/promises";
import path from "node:path";
import { normalizePersistedRunState } from "./normalizers.js";
import { readJsonIfExists, pathExists, normalizeRunStatus } from "./artifact-utils.js";
export async function resolveResumeStatePath(repoRoot, rules, resumeTarget) {
    const target = String(resumeTarget || "").trim();
    if (!target) {
        throw new Error("Missing resume target.");
    }
    if (target === "last") {
        return await resolveLatestRunStatePath(repoRoot, rules, "No resumable runs found");
    }
    const absoluteTarget = path.resolve(target);
    const stat = await fs.stat(absoluteTarget);
    if (stat.isDirectory()) {
        const statePath = path.join(absoluteTarget, "run-state.json");
        await fs.access(statePath);
        return statePath;
    }
    return absoluteTarget;
}
export async function loadRecentRunSummary(repoRoot, rules, resumeTarget = "last") {
    const statePath = resumeTarget === "last"
        ? await resolveLatestRunStatePath(repoRoot, rules, "No runs found")
        : await resolveResumeStatePath(repoRoot, rules, resumeTarget);
    const runStateRaw = JSON.parse(await fs.readFile(statePath, "utf8"));
    const runState = normalizePersistedRunState(runStateRaw);
    const runDir = path.dirname(statePath);
    const indexPath = path.join(runDir, "artifact-index.json");
    const planningRoutingPath = path.join(runDir, "00-routing", "planning.json");
    const implementationRoutingPath = path.join(runDir, "00-routing", "implementation.json");
    const artifactIndex = await readJsonIfExists(indexPath);
    const planningRouting = await readJsonIfExists(planningRoutingPath);
    const implementationRouting = await readJsonIfExists(implementationRoutingPath);
    return {
        statePath,
        runState: runState,
        artifactIndex,
        routing: {
            planning: planningRouting?.decision ?? null,
            implementation: implementationRouting?.decision ?? null
        }
    };
}
export async function listRecentRunSummaries(repoRoot, rules, limit = 10) {
    const runDirs = await listRunDirectories(repoRoot, rules);
    const summaries = [];
    for (const runDir of runDirs.slice(0, Math.max(0, limit))) {
        const summary = await loadRunSummaryFromDirectory(runDir);
        if (summary) {
            summaries.push(summary);
        }
    }
    return summaries;
}
export async function loadRunSummary(repoRoot, rules, target) {
    const normalizedTarget = String(target || "").trim();
    if (!normalizedTarget || normalizedTarget === "last") {
        return await loadRecentRunSummary(repoRoot, rules, "last");
    }
    const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
    const repoRelativeTarget = path.resolve(repoRoot, normalizedTarget);
    const artifactRelativeTarget = path.join(artifactsDir, normalizedTarget);
    const absoluteTarget = path.isAbsolute(normalizedTarget)
        ? normalizedTarget
        : (await pathExists(repoRelativeTarget))
            ? repoRelativeTarget
            : artifactRelativeTarget;
    try {
        const stat = await fs.stat(absoluteTarget);
        if (stat.isDirectory()) {
            return await loadRecentRunSummary(repoRoot, rules, absoluteTarget);
        }
    }
    catch {
        // Fall through and let resolveResumeStatePath-style handling report a better error below.
    }
    return await loadRecentRunSummary(repoRoot, rules, absoluteTarget);
}
export async function loadSavedContextArtifacts(statePathOrRunDir, expectedPaths) {
    const contextDir = typeof statePathOrRunDir === "string"
        ? path.join(statePathOrRunDir.endsWith("run-state.json") ? path.dirname(statePathOrRunDir) : statePathOrRunDir, "02-context", "files")
        : statePathOrRunDir.stepPaths.context
            ? path.join(statePathOrRunDir.stepPaths.context, "files")
            : null;
    if (!contextDir) {
        return [];
    }
    const contexts = [];
    for (const relativePath of expectedPaths) {
        const targetPath = path.join(contextDir, relativePath);
        try {
            const content = await fs.readFile(targetPath, "utf8");
            contexts.push({ path: relativePath, content });
        }
        catch {
            continue;
        }
    }
    return contexts;
}
export async function runArtifactRetentionCleanup(repoRoot, rules, logger) {
    const days = rules.retention?.artifacts_days;
    if (!days || days <= 0) {
        return 0;
    }
    const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
    let entries;
    try {
        entries = await fs.readdir(artifactsDir, { withFileTypes: true });
    }
    catch {
        return 0;
    }
    const now = Date.now();
    const maxAgeMs = days * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith("run-")) {
            continue;
        }
        const runDir = path.join(artifactsDir, entry.name);
        try {
            const stat = await fs.stat(runDir);
            if (now - stat.mtimeMs > maxAgeMs) {
                await fs.rm(runDir, { recursive: true, force: true });
                deletedCount += 1;
            }
        }
        catch {
            // ignore
        }
    }
    if (deletedCount > 0) {
        logger?.info(`Deleted ${deletedCount} old run artifact(s) based on retention policy (${days} days).`);
    }
    return deletedCount;
}
async function resolveLatestRunStatePath(repoRoot, rules, missingMessage) {
    const runDirs = await listRunDirectories(repoRoot, rules);
    for (const runDir of runDirs) {
        const statePath = path.join(runDir, "run-state.json");
        try {
            await fs.access(statePath);
            return statePath;
        }
        catch {
            continue;
        }
    }
    const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
    throw new Error(`${missingMessage} in ${artifactsDir}`);
}
async function listRunDirectories(repoRoot, rules) {
    const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
    let entries;
    try {
        entries = await fs.readdir(artifactsDir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    return entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
        .map((entry) => path.join(artifactsDir, entry.name))
        .sort((left, right) => right.localeCompare(left));
}
async function loadRunSummaryFromDirectory(runDir) {
    const statePath = path.join(runDir, "run-state.json");
    const indexPath = path.join(runDir, "artifact-index.json");
    const runStateRaw = await readJsonIfExists(statePath);
    const artifactIndex = await readJsonIfExists(indexPath);
    if (!runStateRaw && !artifactIndex) {
        return null;
    }
    const normalizedState = runStateRaw ? normalizePersistedRunState(runStateRaw) : null;
    // Integrity Check: ensure critical fields exist if the file is present
    if (normalizedState && (!normalizedState.task || !normalizedState.status)) {
        return null;
    }
    // Try to load diff summaries from the latest iteration manifest
    let diffSummaries = undefined;
    const latestIterationPath = artifactIndex?.latestIterationPath || normalizedState?.artifacts?.latestIterationPath;
    if (latestIterationPath) {
        try {
            const manifestPath = path.isAbsolute(latestIterationPath)
                ? path.join(latestIterationPath, "manifest.json")
                : path.join(runDir, latestIterationPath, "manifest.json");
            const manifest = await readJsonIfExists(manifestPath);
            if (Array.isArray(manifest?.diffSummaries)) {
                diffSummaries = manifest.diffSummaries;
            }
        }
        catch {
            // Ignore failures loading diff summaries
        }
    }
    return {
        statePath,
        runPath: runDir,
        runName: path.basename(runDir),
        status: normalizedState?.status ? normalizeRunStatus(normalizedState.status) : (artifactIndex?.latestStatus ? normalizeRunStatus(artifactIndex.latestStatus) : "running"),
        task: normalizedState?.task ?? artifactIndex?.latestTask ?? "",
        dryRun: normalizedState?.dryRun ?? false,
        updatedAt: artifactIndex?.updatedAt ?? null,
        iterationCount: artifactIndex?.iterationCount ?? normalizedState?.iterations?.length ?? 0,
        latestFiles: normalizedState?.result?.files?.map((file) => file.path) ?? artifactIndex?.latestFiles ?? [],
        diffSummaries,
        latestToolResults: normalizedState?.latestToolResults ?? artifactIndex?.latestToolResults ?? [],
        execution: normalizedState?.execution ?? artifactIndex?.execution ?? null,
        approvalPolicy: normalizedState?.approvalPolicy ?? artifactIndex?.approvalPolicy ?? null,
        latestApplyEventPath: artifactIndex?.latestApplyEventPath ?? null,
        lastAppliedAt: artifactIndex?.lastAppliedAt ?? null,
        applyEventCount: artifactIndex?.applyEventCount ?? 0,
        externalTask: normalizedState?.externalTask ?? artifactIndex?.externalTask,
        refactorAnalysis: normalizedState?.refactorAnalysis ?? artifactIndex?.refactorAnalysis,
        contracts: normalizedState?.plan?.contracts ?? []
    };
}
