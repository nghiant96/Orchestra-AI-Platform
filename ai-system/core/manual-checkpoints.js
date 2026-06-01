import fs from "node:fs/promises";
import path from "node:path";
import { filterExistingSafeReadFiles, filterSafeWriteTargets } from "./context.js";
export async function loadEditablePlanCheckpoint(artifactPath, fallbackPlan, repoRoot, rules, logger) {
    if (!artifactPath) {
        return fallbackPlan;
    }
    const manifest = await readJsonIfExists(path.join(artifactPath, "plan.json"));
    const editedPlan = normalizeEditablePlan(manifest?.normalizedPlan ?? manifest?.plan ?? manifest, fallbackPlan);
    if (!editedPlan) {
        return fallbackPlan;
    }
    const readFiles = await filterExistingSafeReadFiles(repoRoot, editedPlan.readFiles, rules, logger);
    const writeTargets = filterSafeWriteTargets(editedPlan.writeTargets, rules, logger);
    const nextPlan = {
        prompt: editedPlan.prompt || fallbackPlan.prompt,
        readFiles,
        writeTargets,
        notes: editedPlan.notes
    };
    if (JSON.stringify(nextPlan) !== JSON.stringify(fallbackPlan)) {
        logger?.info(`Loaded edited plan checkpoint from ${path.join(artifactPath, "plan.json")}`);
    }
    return nextPlan;
}
export async function loadEditableContextCheckpoint(artifactPath, fallbackContexts, logger) {
    if (!artifactPath) {
        return fallbackContexts;
    }
    const manifest = await readJsonIfExists(path.join(artifactPath, "context.json"));
    const candidatePaths = normalizePathList(manifest?.savedFiles).length > 0
        ? normalizePathList(manifest?.savedFiles)
        : normalizePathList(manifest?.readFiles);
    const paths = candidatePaths.length > 0 ? candidatePaths : fallbackContexts.map((context) => context.path);
    const filesRoot = path.join(artifactPath, "files");
    const contexts = [];
    for (const relativePath of paths) {
        if (!isSafeRelativePath(relativePath)) {
            logger?.warn(`Skipping unsafe edited context path: ${relativePath}`);
            continue;
        }
        try {
            contexts.push({
                path: relativePath,
                content: await fs.readFile(path.join(filesRoot, relativePath), "utf8")
            });
        }
        catch {
            logger?.warn(`Skipping missing edited context artifact: ${relativePath}`);
        }
    }
    if (contexts.length === 0) {
        return fallbackContexts;
    }
    logger?.info(`Loaded ${contexts.length} edited context artifact(s) from ${artifactPath}`);
    return contexts;
}
function normalizeEditablePlan(value, fallbackPlan) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const candidate = value;
    const prompt = typeof candidate.prompt === "string" ? candidate.prompt : fallbackPlan.prompt;
    const readFiles = normalizePathList(candidate.readFiles);
    const writeTargets = normalizePathList(candidate.writeTargets);
    const notes = Array.isArray(candidate.notes) ? candidate.notes.map(String) : fallbackPlan.notes;
    return {
        prompt,
        readFiles: readFiles.length > 0 ? readFiles : fallbackPlan.readFiles,
        writeTargets: writeTargets.length > 0 ? writeTargets : fallbackPlan.writeTargets,
        notes
    };
}
function normalizePathList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => String(entry || "").replace(/\\/g, "/").replace(/^\.\/+/, "")).filter(isSafeRelativePath);
}
function isSafeRelativePath(value) {
    return Boolean(value) && !path.isAbsolute(value) && !value.split("/").includes("..");
}
async function readJsonIfExists(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
