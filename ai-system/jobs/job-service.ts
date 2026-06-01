import fs from "node:fs/promises";
import path from "node:path";
import type { FileBackedJobQueue, JobQueueRunInput, QueueJob, QueueJobStatus } from "../core/job-queue.js";
import type { FileAuditLog, AuditActor } from "../core/audit-log.js";
import { resolveApprovalPolicy } from "../core/risk-policy.js";
import { parseExternalTask, normalizeExternalTaskToPrompt } from "../core/external-task.js";
import { listRecentRunSummaries } from "../core/artifacts.js";
import { classifyServerError } from "../core/server-analytics.js";
import { loadJsonIfExists } from "../utils/config.js";
import type { RulesConfig, OrchestratorResult, ExternalTaskRef, RunStatus } from "../types.js";
import type { WorkflowMode } from "../core/workflow-modes.js";
import type { WorkflowProfileId } from "../workflows/workflow-profile.js";
import {
  applyWorkflowProfileToTask,
  parseWorkflowProfileId,
  tightenApprovalPolicyForProfile
} from "../workflows/workflow-registry.js";
import {
  createApprovalArtifactBinding,
  normalizeApprovalProof,
  validateApprovalProof,
  type ApprovalArtifactBinding,
  type ApprovalProof
} from "../approvals/approval-proof.js";

export interface JobServiceContext {
  queue: FileBackedJobQueue;
  auditLog: FileAuditLog;
  actor: AuditActor;
  rules: RulesConfig;
}

export async function createSyncRun(
  ctx: JobServiceContext & { runNow: (input: JobQueueRunInput) => Promise<OrchestratorResult> },
  input: { task: string; cwd: string; dryRun?: boolean; workflowMode?: WorkflowMode; workflowProfile?: unknown }
): Promise<OrchestratorResult> {
  const workflowProfile = parseWorkflowProfileId(input.workflowProfile);
  return ctx.runNow({
    jobId: `sync-${Date.now().toString(36)}`,
    task: applyWorkflowProfileToTask(input.task, workflowProfile),
    cwd: input.cwd,
    dryRun: input.dryRun !== false,
    workflowMode: input.workflowMode ?? "standard",
    workflowProfile
  });
}

export async function createJob(
  ctx: JobServiceContext,
  input: {
    task: string;
    cwd: string;
    dryRun?: boolean;
    workflowMode?: unknown;
    workflowProfile?: unknown;
    externalUrl?: string;
  }
): Promise<QueueJob> {
  const { rules } = await loadRules(input.cwd);
  let effectiveTask = input.task;
  let externalTask: ExternalTaskRef | undefined;
  const parsedWorkflowMode = parseWorkflowMode(input.workflowMode);
  const workflowProfile = parseWorkflowProfileId(input.workflowProfile);
  let effectiveWorkflowMode: WorkflowMode = parsedWorkflowMode ?? "standard";

  if (input.externalUrl || input.task) {
    const parsed = parseExternalTask(input.externalUrl || input.task);
    if (parsed) {
      externalTask = parsed;
      if (!effectiveTask || effectiveTask === parsed.url) effectiveTask = normalizeExternalTaskToPrompt(parsed);
      if (parsed.kind === "pull_request" && !input.workflowMode) effectiveWorkflowMode = "review";
    } else if (input.externalUrl) {
      throw new JobServiceError("Invalid external task URL", 400);
    }
  }

  if (!effectiveTask) {
    throw new JobServiceError("Missing task", 400);
  }

  const profiledTask = applyWorkflowProfileToTask(effectiveTask, workflowProfile);
  const approvalMode = tightenApprovalPolicyForProfile(
    resolveApprovalPolicy(profiledTask, rules, [], { workflowMode: effectiveWorkflowMode }),
    workflowProfile
  );
  const job = await ctx.queue.enqueue({
    task: profiledTask,
    cwd: input.cwd,
    dryRun: input.dryRun !== false,
    workflowMode: effectiveWorkflowMode,
    workflowProfile,
    approvalMode: approvalMode?.approvalMode ?? "manual",
    approvalPolicy: approvalMode ?? undefined,
    externalTask
  });

  await ctx.auditLog.append({
    actor: ctx.actor,
    action: "job.create",
    cwd: input.cwd,
    jobId: job.jobId,
    details: {
      dryRun: job.dryRun,
      approvalMode: job.approvalMode,
      riskClass: job.approvalPolicy?.riskClass ?? null,
      workflowMode: job.workflowMode ?? null,
      workflowProfile: job.workflowProfile ?? null
    }
  });

  return job;
}

export async function listJobs(
  ctx: JobServiceContext,
  filterCwd: string
): Promise<{ version: number; jobs: QueueJob[] }> {
  const jobs = await ctx.queue.list();
  const filteredQueueJobs = jobs.filter((j) => isPathWithinRoot(filterCwd, j.cwd));

  try {
    const { rules } = await loadRules(filterCwd);
    const recentRuns = await listRecentRunSummaries(filterCwd, rules, 20);
    const runJobs: QueueJob[] = recentRuns
      .filter((run) => !jobs.some((j) => j.artifactPath === run.runPath || j.jobId === run.runName))
      .map((run) => mapRunSummaryToQueueJob(run, filterCwd));
    const merged = [...filteredQueueJobs, ...runJobs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return { version: 1, jobs: merged.slice(0, 50) };
  } catch {
    return { version: 1, jobs: filteredQueueJobs };
  }
}

export async function getJob(ctx: JobServiceContext, jobId: string): Promise<QueueJob | null> {
  return ctx.queue.get(jobId);
}

export async function cancelJob(ctx: JobServiceContext, jobId: string): Promise<QueueJob | null> {
  const job = await ctx.queue.cancel(jobId);
  if (job) {
    await ctx.auditLog.append({ actor: ctx.actor, action: "job.cancel", cwd: job.cwd, jobId: job.jobId });
  }
  return job;
}

export async function approveJob(
  ctx: JobServiceContext,
  jobId: string,
  action: "approve" | "reject",
  pendingApprovals: Map<string, { resolve(value: boolean): void; type: "plan" | "checkpoint"; data?: unknown; binding?: ApprovalArtifactBinding }>,
  options: { proof?: Partial<ApprovalProof>; requireProof?: boolean } = {}
): Promise<{ ok: boolean; jobId: string; approved: boolean; approvalArtifact?: ApprovalArtifactBinding; proof?: ApprovalProof } | null> {
  const pendingApproval = pendingApprovals.get(jobId);
  const job = await ctx.queue.get(jobId);
  if (!pendingApproval || !job) {
    return null;
  }
  const binding = pendingApproval.binding ?? createApprovalArtifactBinding(pendingApproval.data, pendingApproval.type);
  const proofResult = validateApprovalProof(binding, options.proof, { requireProof: options.requireProof });
  if (!proofResult.ok) {
    throw new JobServiceError(proofResult.error, proofResult.statusCode);
  }
  pendingApprovals.delete(jobId);
  pendingApproval.resolve(action === "approve");
  await ctx.queue.updateJob(job, {
    approvalArtifact: binding
  });
  await ctx.auditLog.append({
    actor: ctx.actor,
    action: `job.${action}`,
    cwd: job.cwd,
    jobId,
    details: {
      approvalType: pendingApproval.type,
      approvalArtifact: binding,
      approvalProof: proofResult.proof
        ? {
            approvedBy: proofResult.proof.approvedBy,
            approvalSource: proofResult.proof.approvalSource,
            userConfirmationId: proofResult.proof.userConfirmationId
          }
        : undefined
    }
  });
  return { ok: true, jobId, approved: action === "approve", approvalArtifact: binding, proof: proofResult.proof };
}

export { normalizeApprovalProof };

export async function getJobFileContent(
  ctx: JobServiceContext,
  jobId: string,
  filePath: string,
  type: string,
  requestedCwd: string
): Promise<{ ok: boolean; content?: string; error?: string; statusCode?: number }> {
  const job = await ctx.queue.get(jobId);
  let artifactPath = job?.artifactPath;

  if (!artifactPath && jobId.startsWith("run-")) {
    const { rules } = await loadRules(requestedCwd);
    const artifactsDir = path.resolve(requestedCwd, rules.artifacts?.data_dir || ".ai-system-artifacts");
    artifactPath = path.join(artifactsDir, jobId);
  }

  if (!artifactPath) {
    return { ok: false, statusCode: 404, error: "Job not found or no artifacts" };
  }

  try {
    const index = await loadJsonIfExists<any>(path.join(artifactPath, "artifact-index.json"));
    const latestIterationPath = index?.latestIterationPath;
    if (!latestIterationPath) {
      return { ok: false, statusCode: 404, error: "No iteration data found" };
    }
    const iterationDir = path.isAbsolute(latestIterationPath)
      ? latestIterationPath
      : path.join(artifactPath, latestIterationPath);
    const subDir = type === "original" ? "files-original" : "files";
    const fullPath = path.join(iterationDir, subDir, filePath);
    const content = await fs.readFile(fullPath, "utf8");
    return { ok: true, content };
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "ENOENT") {
      return { ok: false, statusCode: 404, error: "File not found in artifacts" };
    }
    return {
      ok: false,
      statusCode: 500,
      error: err instanceof Error ? err.message : "Failed to read job artifact content"
    };
  }
}

export function parseWorkflowMode(value: unknown): WorkflowMode | null {
  return value === "standard" || value === "implement" || value === "review" || value === "fix" || value === "refactor"
    ? value
    : null;
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

export function mapRunSummaryToQueueJob(
  run: Awaited<ReturnType<typeof listRecentRunSummaries>>[number],
  defaultCwd: string
): QueueJob {
  return {
    version: 1,
    jobId: run.runName,
    status: normalizeRunStatus(run.status),
    task: run.task,
    cwd: defaultCwd,
    dryRun: run.dryRun,
    approvalMode:
      run.approvalPolicy?.approvalMode ??
      (run.status === "paused_after_plan" || run.status === "paused_after_generate" ? "manual" : undefined),
    approvalPolicy: run.approvalPolicy ?? undefined,
    createdAt: run.updatedAt || new Date().toISOString(),
    updatedAt: run.updatedAt || new Date().toISOString(),
    artifactPath: run.runPath,
    resultSummary: run.execution?.failure?.reason || run.status,
    failure: run.status === "failed" ? classifyServerError(run.execution?.failure?.reason) : undefined,
    diffSummaries: run.diffSummaries,
    latestToolResults: run.latestToolResults,
    execution: run.execution
      ? {
          transitions: run.execution.transitions,
          providerMetrics: run.execution.providerMetrics,
          budget: run.execution.budget,
          totalDurationMs: run.execution.totalDurationMs,
          retryHint: run.execution.retryHint ?? null
        }
      : undefined
  };
}

function normalizeRunStatus(status: RunStatus | string): QueueJobStatus {
  switch (status) {
    case "completed":
    case "resumed_completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "paused_after_plan":
    case "paused_after_generate":
      return "waiting_for_approval";
    default:
      return "failed";
  }
}

async function loadRules(cwd: string) {
  const { loadRules } = await import("../core/orchestrator-runtime.js");
  return loadRules(cwd);
}

export class JobServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "JobServiceError";
  }
}
