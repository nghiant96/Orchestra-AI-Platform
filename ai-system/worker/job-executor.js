import fs from "node:fs/promises";
import path from "node:path";
import { ensurePathWithinRoot, redactWorkerLogLine } from "./worker-safety.js";
export async function executeWorkerJob(ctx) {
    const logs = [];
    const emit = (message) => {
        const line = redactWorkerLogLine(message);
        logs.push(line);
        ctx.emitLog(line);
    };
    emit(`claimed job ${ctx.job.jobId}`);
    emit(`task: ${redactWorkerLogLine(ctx.job.task)}`);
    const mutation = parseMutationInstruction(ctx.job.task);
    if (mutation) {
        const workspaceRoot = ctx.workspaceRoots[0] ?? ctx.job.cwd;
        const targetPath = ensurePathWithinRoot(workspaceRoot, path.join(workspaceRoot, mutation.relativePath));
        emit(`checkpointing filesystem mutation for ${mutation.relativePath}`);
        await ctx.markFilesystemMutation("apply_patch", workspaceRoot);
        emit(`writing ${mutation.relativePath}`);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, mutation.content, "utf8");
        emit(`wrote ${mutation.relativePath}`);
        return {
            ok: true,
            summary: `Wrote ${mutation.relativePath}`,
            logs,
            filesystemMutated: true
        };
    }
    emit("dummy job completed without filesystem changes");
    return {
        ok: true,
        summary: "No-op worker execution completed.",
        logs,
        filesystemMutated: false
    };
}
function parseMutationInstruction(task) {
    const trimmed = task.trim();
    const match = /^worker:write-file\s+(.+?)::([\s\S]*)$/.exec(trimmed);
    if (!match) {
        return null;
    }
    const relativePath = match[1]?.trim() || "";
    const content = match[2] ?? "";
    if (!relativePath) {
        return null;
    }
    return { relativePath, content };
}
