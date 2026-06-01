import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
export function resolveWorkspaceRegistryPath(defaultCwd) {
    return path.join(defaultCwd, ".ai-system-server", "workspaces.json");
}
export function loadAllowedWorkdirs(defaultCwd, envRoots = []) {
    const registryRoots = loadWorkspaceRegistryRoots(defaultCwd);
    const merged = unique([
        ...normalizeRoots(envRoots),
        ...normalizeRoots(registryRoots)
    ]);
    return merged.length > 0 ? merged : [path.resolve(defaultCwd)];
}
export async function registerWorkspaceRoot(defaultCwd, cwd, existingRoots) {
    const resolved = normalizeWorkspaceRoot(cwd);
    if (!resolved) {
        throw new Error("Workspace path is required");
    }
    const realpath = await fsPromises.realpath(resolved).catch(() => null);
    if (!realpath) {
        throw new Error("Workspace path must point to an existing directory");
    }
    const stat = await fsPromises.stat(realpath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
        throw new Error("Workspace path must point to an existing directory");
    }
    const roots = unique([...normalizeRoots(existingRoots), realpath]);
    await persistWorkspaceRoots(defaultCwd, roots);
    return roots;
}
function loadWorkspaceRegistryRoots(defaultCwd) {
    try {
        const file = fs.readFileSync(resolveWorkspaceRegistryPath(defaultCwd), "utf8");
        const parsed = JSON.parse(file);
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.roots)) {
            return [];
        }
        return parsed.roots.filter((root) => typeof root === "string");
    }
    catch {
        return [];
    }
}
async function persistWorkspaceRoots(defaultCwd, roots) {
    const filePath = resolveWorkspaceRegistryPath(defaultCwd);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    const payload = {
        version: 1,
        roots,
        updatedAt: new Date().toISOString()
    };
    await fsPromises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
function normalizeRoots(values) {
    return values.map(normalizeWorkspaceRoot).filter((root) => Boolean(root));
}
function normalizeWorkspaceRoot(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed)
        return null;
    const resolved = path.resolve(trimmed);
    return path.isAbsolute(resolved) ? resolved : null;
}
function unique(values) {
    return [...new Set(values)];
}
