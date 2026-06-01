import { validatePath } from "../security/path-policy.js";
import { cancelOrRetryWorkItem, createWorkItem, getWorkItem, getWorkItemEvents, runWorkItem } from "../work/work-item-service.js";
import { approveJob, getJob } from "../jobs/job-service.js";
import { normalizeApprovalProof } from "../approvals/approval-proof.js";
import { RepoRegistryError, resolveRegisteredRepoPath } from "../repos/repo-registry.js";
export class McpToolError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
        this.name = "McpToolError";
    }
}
export async function executeMcpTool(ctx, name, input = {}) {
    const actor = requireMcpActor(ctx);
    const workCtx = {
        actor,
        auditLog: ctx.auditLog,
        rules: ctx.rules,
        queue: ctx.queue
    };
    const jobCtx = {
        actor,
        auditLog: ctx.auditLog,
        rules: ctx.rules,
        queue: ctx.queue
    };
    switch (name) {
        case "orchestra_create_work_item": {
            const cwd = await resolveMcpCwd(ctx, input);
            const repo = await resolveMcpRepo(ctx, input);
            return createWorkItem(workCtx, cwd, repo
                ? {
                    ...input,
                    repo: {
                        ...(typeof input.repo === "object" && input.repo !== null ? input.repo : {}),
                        repoId: repo.repoId,
                        localPath: repo.localPath,
                        remote: repo.remote
                    }
                }
                : input);
        }
        case "orchestra_run_work_item": {
            const cwd = await resolveMcpCwd(ctx, input);
            const workItemId = requireString(input.workItemId, "workItemId");
            return runWorkItem(workCtx, cwd, workItemId, {
                dryRun: input.dryRun !== false,
                nodeId: typeof input.nodeId === "string" ? input.nodeId : undefined
            });
        }
        case "orchestra_get_work_item": {
            const cwd = await resolveMcpCwd(ctx, input);
            return getWorkItem(workCtx, cwd, requireString(input.workItemId, "workItemId"));
        }
        case "orchestra_get_events": {
            const cwd = await resolveMcpCwd(ctx, input);
            return getWorkItemEvents(workCtx, cwd, requireString(input.workItemId, "workItemId"));
        }
        case "orchestra_get_artifacts": {
            return getMcpArtifacts(ctx, actor, input);
        }
        case "orchestra_approve_step": {
            const pendingApprovals = ctx.pendingApprovals;
            if (!pendingApprovals) {
                throw new McpToolError("Pending approval store is not configured", 500);
            }
            const proof = normalizeApprovalProof(input.approvalProof ?? input);
            const action = input.action === "reject" ? "reject" : "approve";
            const result = await approveJob(jobCtx, requireString(input.jobId, "jobId"), action, pendingApprovals, {
                proof,
                requireProof: true
            });
            if (!result) {
                throw new McpToolError("Pending approval not found", 404);
            }
            return result;
        }
        case "orchestra_cancel_work_item": {
            const cwd = await resolveMcpCwd(ctx, input);
            return cancelOrRetryWorkItem(workCtx, cwd, requireString(input.workItemId, "workItemId"), "cancel");
        }
        case "orchestra_get_lesson": {
            const { getWorkItemLesson } = await import("../work/work-item-service.js");
            const cwd = await resolveMcpCwd(ctx, input);
            return getWorkItemLesson(workCtx, cwd, requireString(input.workItemId, "workItemId"));
        }
        default:
            throw new McpToolError(`Unknown MCP tool: ${name}`, 404);
    }
}
async function getMcpArtifacts(ctx, actor, input) {
    if (typeof input.jobId === "string") {
        const job = await getJob({
            actor,
            auditLog: ctx.auditLog,
            queue: ctx.queue,
            rules: ctx.rules
        }, input.jobId);
        return {
            ok: Boolean(job),
            artifacts: job
                ? [{
                        jobId: job.jobId,
                        artifactPath: job.artifactPath ?? null,
                        approvalArtifact: job.approvalArtifact ?? null,
                        diffSummaries: job.diffSummaries ?? [],
                        latestToolResults: job.latestToolResults ?? []
                    }]
                : []
        };
    }
    const cwd = await resolveMcpCwd(ctx, input);
    const workItem = await getWorkItem({
        actor,
        auditLog: ctx.auditLog,
        queue: ctx.queue,
        rules: ctx.rules
    }, cwd, requireString(input.workItemId, "workItemId"));
    const linkedRuns = workItem.workItem?.linkedRuns ?? [];
    const jobs = await Promise.all(linkedRuns.map((runId) => ctx.queue.get(runId)));
    return {
        ok: workItem.ok,
        workItemId: input.workItemId,
        artifacts: jobs.filter(Boolean).map((job) => ({
            jobId: job.jobId,
            artifactPath: job.artifactPath ?? null,
            approvalArtifact: job.approvalArtifact ?? null,
            diffSummaries: job.diffSummaries ?? [],
            latestToolResults: job.latestToolResults ?? []
        }))
    };
}
function requireMcpActor(ctx) {
    if (!ctx.actor) {
        throw new McpToolError("MCP actor is required", 401);
    }
    return ctx.actor;
}
async function resolveMcpCwd(ctx, input) {
    const repo = await resolveMcpRepo(ctx, input);
    const requested = typeof input.cwd === "string" && input.cwd.trim()
        ? input.cwd.trim()
        : repo?.localPath ?? ctx.defaultCwd;
    const validation = await validatePath(requested, ctx.allowedRoots);
    if (!validation.allowed) {
        throw new McpToolError("Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS", 403);
    }
    return validation.realpath ?? requested;
}
async function resolveMcpRepo(ctx, input) {
    const repoId = typeof input.repoId === "string"
        ? input.repoId
        : typeof input.repo === "object" && input.repo !== null && typeof input.repo.repoId === "string"
            ? input.repo.repoId
            : undefined;
    if (!repoId)
        return null;
    try {
        const repo = await resolveRegisteredRepoPath(ctx.defaultCwd, repoId, ctx.allowedRoots);
        if (!repo)
            throw new McpToolError("Repo not found", 404);
        return repo;
    }
    catch (err) {
        if (err instanceof RepoRegistryError) {
            throw new McpToolError(err.message, err.statusCode);
        }
        throw err;
    }
}
function requireString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
        throw new McpToolError(`${field} is required`, 400);
    }
    return value.trim();
}
