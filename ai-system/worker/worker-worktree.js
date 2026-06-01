import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/api.js";
import { ensurePathWithinRoot } from "./worker-safety.js";
export async function prepareWorkerWorktree(input) {
    const sourceRepoPath = await resolveExistingPath(input.cwd);
    const workspaceRoot = await findContainingRoot(sourceRepoPath, input.workspaceRoots);
    if (!workspaceRoot) {
        throw new Error(`Job cwd is outside worker workspace roots: ${input.cwd}`);
    }
    await runCommand({
        command: "git",
        args: ["rev-parse", "--is-inside-work-tree"],
        cwd: sourceRepoPath,
        timeoutMs: 10000
    });
    const worktreePath = ensurePathWithinRoot(workspaceRoot, path.join(workspaceRoot, ".orchestra", "worktrees", sanitizePathPart(input.jobId)));
    const artifactDir = ensurePathWithinRoot(sourceRepoPath, path.join(sourceRepoPath, ".ai-system-server", "worker-artifacts", sanitizePathPart(input.jobId)));
    await fs.rm(worktreePath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });
    await fs.mkdir(artifactDir, { recursive: true });
    await runCommand({
        command: "git",
        args: ["worktree", "add", "--detach", worktreePath, "HEAD"],
        cwd: sourceRepoPath,
        timeoutMs: 30000
    });
    return {
        workspaceRoot,
        sourceRepoPath,
        worktreePath,
        artifactDir
    };
}
async function findContainingRoot(candidate, roots) {
    for (const root of roots) {
        try {
            const resolvedRoot = await resolveExistingPath(root);
            ensurePathWithinRoot(resolvedRoot, candidate);
            return resolvedRoot;
        }
        catch {
            // Try next root.
        }
    }
    return null;
}
async function resolveExistingPath(value) {
    return fs.realpath(value);
}
function sanitizePathPart(value) {
    return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "job";
}
