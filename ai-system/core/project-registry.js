import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectConfigPath } from "../utils/config.js";
import { resolveJobQueueDirectory } from "./job-queue.js";
export async function buildProjectRegistry(workdirs, loadRulesForProject) {
    const entries = await Promise.all(unique(workdirs).map(async (cwd) => {
        const resolved = path.resolve(cwd);
        const exists = await pathExists(resolved);
        let artifactDataDir = ".ai-system-artifacts";
        try {
            artifactDataDir = (await loadRulesForProject(resolved)).rules.artifacts?.data_dir ?? artifactDataDir;
        }
        catch {
            artifactDataDir = ".ai-system-artifacts";
        }
        return {
            id: slugProjectId(resolved),
            name: path.basename(resolved) || resolved,
            cwd: resolved,
            configPath: await resolveProjectConfigPath(resolved),
            queueDir: resolveJobQueueDirectory(resolved),
            artifactsDir: path.join(resolved, artifactDataDir),
            exists
        };
    }));
    return entries.sort((left, right) => left.name.localeCompare(right.name));
}
function slugProjectId(cwd) {
    return cwd.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";
}
function unique(values) {
    return [...new Set(values)];
}
async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    }
    catch {
        return false;
    }
}
