import path from "node:path";
import type { FileBackedJobQueue, QueueJob } from "../core/job-queue.js";
import type { FileAuditLog, AuditActor } from "../core/audit-log.js";
import type { RulesConfig } from "../types.js";
import type { WorkflowMode } from "../core/workflow-modes.js";
import type { WorkItem, WorkItemType, WorkItemSource, ExpectedOutput } from "./work-item.js";
import { WorkStore } from "./work-store.js";
import { WorkEngine } from "./work-engine.js";

export interface WorkItemServiceContext {
  actor: AuditActor;
  auditLog: FileAuditLog;
  rules: RulesConfig;
  queue: FileBackedJobQueue;
}

export async function listWorkItems(
  ctx: WorkItemServiceContext,
  cwd: string
): Promise<{ ok: boolean; version: number; workItems: WorkItem[] }> {
  const { rules } = await loadRules(cwd);
  const store = new WorkStore(cwd, rules);
  const engine = new WorkEngine(rules);
  const workItems = await Promise.all(
    (await store.list()).map((item) => reconcileWorkItem(item, engine, ctx.queue))
  );
  return { ok: true, version: 1, workItems };
}

export async function createWorkItem(
  ctx: WorkItemServiceContext,
  cwd: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; workItem: WorkItem }> {
  const { rules } = await loadRules(cwd);
  const store = new WorkStore(cwd, rules);
  const input = normalizeWorkItemInput(payload);
  const workItem = await store.create({
    title: input.title,
    projectId: path.basename(cwd),
    description: input.description,
    type: input.type,
    source: input.source,
    expectedOutput: input.expectedOutput,
    linkedRuns: input.linkedRuns
  } as any);
  await ctx.auditLog.append({
    actor: ctx.actor,
    action: "work_item.create",
    cwd,
    details: { workItemId: workItem.id }
  });
  return { ok: true, workItem };
}

export async function getWorkItem(
  ctx: WorkItemServiceContext,
  cwd: string,
  workItemId: string
): Promise<{ ok: boolean; workItem?: WorkItem; error?: string }> {
  const { rules } = await loadRules(cwd);
  const store = new WorkStore(cwd, rules);
  const workItem = await store.load(workItemId);
  if (!workItem) {
    return { ok: false, error: "Work item not found" };
  }
  const engine = new WorkEngine(rules);
  const reconciled = await reconcileWorkItem(workItem, engine, ctx.queue);
  if (reconciled.updatedAt !== workItem.updatedAt) {
    await store.save(reconciled);
  }
  return { ok: true, workItem: reconciled };
}

export async function assessWorkItem(
  ctx: WorkItemServiceContext,
  cwd: string,
  workItemId: string
): Promise<{ ok: boolean; workItem?: WorkItem; error?: string }> {
  const { rules } = await loadRules(cwd);
  const store = new WorkStore(cwd, rules);
  const workItem = await store.load(workItemId);
  if (!workItem) {
    return { ok: false, error: "Work item not found" };
  }
  const assessed = await new WorkEngine(rules).assess(workItem);
  await store.save(assessed);
  await ctx.auditLog.append({
    actor: ctx.actor,
    action: "work_item.assess",
    cwd,
    details: { workItemId }
  });
  return { ok: true, workItem: assessed };
}

export async function runWorkItem(
  ctx: WorkItemServiceContext,
  cwd: string,
  workItemId: string,
  options: { dryRun?: boolean; nodeId?: string } = {}
): Promise<{ ok: boolean; workItem: WorkItem; error?: string; statusCode?: number; job?: QueueJob; jobs?: QueueJob[] }> {
  const { rules } = await loadRules(cwd);
  const store = new WorkStore(cwd, rules);
  const workItem = await store.load(workItemId);
  if (!workItem) {
    return { ok: false, workItem: null as any, error: "Work item not found", statusCode: 404 };
  }
  const engine = new WorkEngine(rules);
  const reconciled = await reconcileWorkItem(workItem, engine, ctx.queue);
  const { workItem: planned, requests } = await engine.createNodeExecutionRequests(reconciled, {
    dryRun: options.dryRun !== false,
    nodeId: options.nodeId
  });

  if (requests.length === 0) {
    const updated = {
      ...planned,
      status: planned.graph?.nodes.some((node) => node.status === "failed")
        ? ("failed" as const)
        : planned.status,
      updatedAt: new Date().toISOString()
    };
    await store.save(updated);
    return { ok: false, workItem: updated, error: "No executable graph node is ready.", statusCode: 409 };
  }

  const jobs: QueueJob[] = [];
  for (const request of requests) {
    jobs.push(
      await ctx.queue.enqueue({
        task: request.task,
        cwd,
        dryRun: request.dryRun,
        workflowMode: request.workflowMode
      })
    );
  }

  const updated = engine.attachQueuedRuns(
    planned,
    jobs.map((job, index) => ({
      nodeId: requests[index]!.nodeId,
      runId: job.jobId
    }))
  );
  await store.save(updated);
  await ctx.auditLog.append({
    actor: ctx.actor,
    action: "work_item.run",
    cwd,
    details: {
      workItemId,
      jobIds: jobs.map((job) => job.jobId),
      nodeIds: requests.map((req) => req.nodeId)
    }
  });

  return { ok: true, workItem: updated, job: jobs[0], jobs };
}

export async function handoffWorkItem(
  ctx: WorkItemServiceContext,
  cwd: string,
  workItemId: string,
  options: { draft?: boolean; base?: string } = {}
): Promise<{ ok: boolean; workItem?: WorkItem; error?: string }> {
  const { rules } = await loadRules(cwd);
  const store = new WorkStore(cwd, rules);
  const workItem = await store.load(workItemId);
  if (!workItem) {
    return { ok: false, error: "Work item not found" };
  }
  const engine = new WorkEngine(rules);
  const reconciled = await reconcileWorkItem(workItem, engine, ctx.queue);
  const handedOff = await engine.handoffToPR(cwd, reconciled, {
    draft: options.draft !== false,
    base: options.base
  });
  await store.save(handedOff);
  await ctx.auditLog.append({
    actor: ctx.actor,
    action: "work_item.handoff",
    cwd,
    details: { workItemId, prNumber: handedOff.pullRequest?.number }
  });
  return { ok: true, workItem: handedOff };
}

export async function cancelOrRetryWorkItem(
  ctx: WorkItemServiceContext,
  cwd: string,
  workItemId: string,
  action: "cancel" | "retry"
): Promise<{ ok: boolean; workItem?: WorkItem; error?: string }> {
  const { rules } = await loadRules(cwd);
  const store = new WorkStore(cwd, rules);
  const workItem = await store.load(workItemId);
  if (!workItem) {
    return { ok: false, error: "Work item not found" };
  }
  const updated = {
    ...workItem,
    status: action === "cancel" ? ("cancelled" as const) : ("created" as const),
    updatedAt: new Date().toISOString()
  };
  await store.save(updated);
  await ctx.auditLog.append({
    actor: ctx.actor,
    action: `work_item.${action}`,
    cwd,
    details: { workItemId }
  });
  return { ok: true, workItem: updated };
}

export function normalizeWorkItemInput(payload: Record<string, unknown>): {
  title: string;
  description: string;
  type: WorkItemType;
  source: WorkItemSource;
  expectedOutput: ExpectedOutput;
  linkedRuns: string[];
  stage?: string;
  executionMode?: string;
  workflowProfile?: string;
  routingProfile?: string;
  requestedBy?: string;
  repo?: { localPath?: string; remote?: string };
} {
  return {
    title: typeof payload?.title === "string" ? payload.title.trim() : "",
    description: typeof payload?.description === "string" ? payload.description : "",
    type: normalizeWorkItemType(payload?.type),
    source: normalizeWorkItemSource(payload?.source),
    expectedOutput: normalizeExpectedOutput(payload?.expectedOutput),
    linkedRuns: Array.isArray(payload?.linkedRuns)
      ? payload.linkedRuns.filter((item: unknown) => typeof item === "string")
      : [],
    stage: typeof payload?.stage === "string" ? payload.stage : undefined,
    executionMode: typeof payload?.executionMode === "string" ? payload.executionMode : undefined,
    workflowProfile: typeof payload?.workflowProfile === "string" ? payload.workflowProfile : undefined,
    routingProfile: typeof payload?.routingProfile === "string" ? payload.routingProfile : undefined,
    requestedBy: typeof payload?.requestedBy === "string" ? payload.requestedBy : undefined,
    repo: typeof payload?.repo === "object" && payload.repo !== null
      ? {
          localPath: typeof (payload.repo as any).localPath === "string"
            ? (payload.repo as any).localPath
            : undefined,
          remote: typeof (payload.repo as any).remote === "string"
            ? (payload.repo as any).remote
            : undefined
        }
      : undefined
  };
}

export function normalizeWorkItemType(value: unknown): WorkItemType {
  return value === "bugfix" || value === "feature" || value === "refactor" || value === "test" || value === "docs" || value === "investigation" || value === "review"
    ? value
    : "feature";
}

export function normalizeWorkItemSource(value: unknown): WorkItemSource {
  return value === "manual" || value === "github_issue" || value === "github_pr" || value === "ci_failure" || value === "api" || value === "webhook"
    ? value
    : "manual";
}

export function normalizeExpectedOutput(value: unknown): ExpectedOutput {
  return value === "report" || value === "patch" || value === "branch" || value === "pull_request"
    ? value
    : "patch";
}

async function reconcileWorkItem(workItem: WorkItem, engine: WorkEngine, queue: FileBackedJobQueue): Promise<WorkItem> {
  if (workItem.linkedRuns.length === 0) return workItem;
  const jobs = (await Promise.all(workItem.linkedRuns.map((runId) => queue.get(runId))))
    .filter((job): job is NonNullable<typeof job> => job !== null);
  return engine.reconcileRunResults(workItem, jobs);
}

async function loadRules(cwd: string) {
  const { loadRules } = await import("../core/orchestrator-runtime.js");
  return loadRules(cwd);
}
