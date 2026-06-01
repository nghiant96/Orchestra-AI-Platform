import fs from "node:fs/promises";
import path from "node:path";
import { ensurePathWithinRoot, redactWorkerLogLine } from "./worker-safety.js";
import { prepareWorkerWorktree } from "./worker-worktree.js";
import { buildProviderEnv } from "./provider-env.js";
import { resolveWorkerProvider } from "./providers/index.js";
export async function executeWorkerJob(ctx) {
    const providerId = (ctx.providerId || process.env.ORCHESTRA_WORKER_PROVIDER || "codex").trim().toLowerCase();
    if (providerId !== "dummy") {
        return executeProviderWorkerJob(ctx, providerId);
    }
    return executeDummyWorkerJob(ctx);
}
async function executeDummyWorkerJob(ctx) {
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
        if (ctx.job.dryRun) {
            emit(`dry-run: would write ${mutation.relativePath}`);
            return {
                ok: true,
                summary: `Dry-run skipped write to ${mutation.relativePath}`,
                logs,
                filesystemMutated: false
            };
        }
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
async function executeProviderWorkerJob(ctx, providerId) {
    const logs = [];
    const emit = (message) => {
        const line = redactWorkerLogLine(message);
        logs.push(line);
        ctx.emitLog(line);
    };
    emit(`claimed job ${ctx.job.jobId}`);
    emit(`provider: ${providerId}`);
    emit(`task: ${redactWorkerLogLine(ctx.job.task)}`);
    let prepared;
    try {
        prepared = await prepareWorkerWorktree({
            jobId: ctx.job.jobId,
            cwd: ctx.job.cwd,
            workspaceRoots: ctx.workspaceRoots
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to prepare worker worktree";
        emit(`worktree preparation failed: ${message}`);
        return {
            ok: false,
            summary: message,
            logs,
            filesystemMutated: false,
            failure: {
                class: "provider-error",
                message,
                step: "worker-worktree",
                retryable: false,
                suggestion: "Ensure the job cwd is a git repository inside the worker workspace roots."
            }
        };
    }
    if (!ctx.job.dryRun) {
        emit(`checkpointing provider filesystem mutation for ${prepared.worktreePath}`);
        await ctx.markFilesystemMutation("provider_execute", prepared.worktreePath);
    }
    const provider = resolveWorkerProvider(providerId, { codexCommand: ctx.providerCommand });
    const input = {
        jobId: ctx.job.jobId,
        task: ctx.job.task,
        cwd: ctx.job.cwd,
        worktreePath: prepared.worktreePath,
        workspaceRoot: prepared.workspaceRoot,
        artifactDir: prepared.artifactDir,
        dryRun: ctx.job.dryRun,
        workflowMode: ctx.job.workflowMode,
        workflowProfile: ctx.job.workflowProfile,
        approvalPolicy: ctx.job.approvalPolicy,
        env: buildProviderEnv(),
    };
    if (!(await provider.isAvailable(input))) {
        const message = `Worker provider is not available: ${provider.id}`;
        emit(message);
        return {
            ok: false,
            summary: message,
            logs,
            filesystemMutated: false,
            artifactPath: prepared.artifactDir,
            failure: {
                class: "provider-error",
                message,
                step: `worker-provider:${provider.id}`,
                retryable: true,
                suggestion: "Install/authenticate the provider CLI or configure ORCHESTRA_WORKER_PROVIDER."
            }
        };
    }
    const result = await provider.execute(input);
    for (const line of result.workerLogs ?? []) {
        emit(line);
    }
    return {
        ok: result.ok,
        summary: result.summary,
        logs,
        filesystemMutated: !ctx.job.dryRun,
        artifactPath: result.artifactPath ?? prepared.artifactDir,
        diffSummaries: result.diffSummaries,
        latestToolResults: result.latestToolResults,
        failure: result.failure
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
