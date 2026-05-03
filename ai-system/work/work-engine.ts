import type { RulesConfig } from "../types.js";
import type { QueueJob } from "../core/job-queue.js";
import type { WorkflowMode } from "../core/workflow-modes.js";
import { assessWorkItem } from "./assessment.js";
import { buildChecklist } from "./checklist.js";
import { buildTaskGraph } from "./task-graph.js";
import type { ChecklistItem, ExecutionGraphNode, WorkItem } from "./work-item.js";
import { prepareWorkItemBranch } from "./branch-manager.js";
import { commitWorkItemChanges, generateWorkItemPRBody } from "./commit-pr.js";
import { watchCiForWorkItem } from "./ci.js";
import { createGhPR } from "./github-pr.js";

export interface WorkNodeExecutionRequest {
  nodeId: string;
  task: string;
  workflowMode: WorkflowMode;
  dryRun: boolean;
}

export interface WorkNodeRunAssignment {
  nodeId: string;
  runId: string;
}

export class WorkEngine {
  constructor(private readonly rules: RulesConfig) { }

  async assess(workItem: WorkItem): Promise<WorkItem> {
    const assessment = assessWorkItem(workItem, this.rules);
    const graph = workItem.graph && workItem.graph.nodes.length > 0 ? workItem.graph : buildTaskGraph(workItem);
    const checklist = workItem.checklist && workItem.checklist.length > 0 ? workItem.checklist : buildChecklist(workItem, graph);
    return { ...workItem, status: "assessing", assessment, graph, checklist };
  }

  async createExecutionPlan(workItem: WorkItem): Promise<WorkItem> {
    const assessed = workItem.assessment && workItem.graph && workItem.graph.nodes.length > 0 && workItem.checklist ? workItem : await this.assess(workItem);
    return {
      ...assessed,
      status: "planning",
      updatedAt: new Date().toISOString()
    };
  }

  async createNodeExecutionRequests(
    workItem: WorkItem,
    options: { dryRun: boolean; nodeId?: string; maxNodes?: number } = { dryRun: true }
  ): Promise<{ workItem: WorkItem; requests: WorkNodeExecutionRequest[] }> {
    const planned = await this.createExecutionPlan(workItem);
    const nodes = selectExecutableNodes(planned, options.nodeId, options.maxNodes ?? 1);
    return {
      workItem: planned,
      requests: nodes.map((node) => ({
        nodeId: node.id,
        task: buildNodePrompt(planned, node),
        workflowMode: workflowModeForNode(planned, node),
        dryRun: options.dryRun
      }))
    };
  }

  attachQueuedRuns(workItem: WorkItem, assignments: WorkNodeRunAssignment[]): WorkItem {
    if (assignments.length === 0) return workItem;
    const assignmentByNode = new Map(assignments.map((assignment) => [assignment.nodeId, assignment.runId]));
    const linkedRuns = Array.from(new Set([...workItem.linkedRuns, ...assignments.map((assignment) => assignment.runId)]));
    const graph = workItem.graph
      ? {
        ...workItem.graph,
        nodes: workItem.graph.nodes.map((node) => {
          const runId = assignmentByNode.get(node.id);
          return runId ? { ...node, status: "running" as const, assignedRunId: runId } : node;
        })
      }
      : workItem.graph;
    const checklist = updateChecklistForAssignments(workItem.checklist ?? [], assignments);
    return {
      ...workItem,
      status: "executing",
      graph,
      checklist,
      linkedRuns,
      updatedAt: new Date().toISOString()
    };
  }

  reconcileRunResults(workItem: WorkItem, jobs: QueueJob[]): WorkItem {
    if (!workItem.graph || jobs.length === 0) return workItem;
    const jobById = new Map(jobs.map((job) => [job.jobId, job]));
    const graph = {
      ...workItem.graph,
      nodes: workItem.graph.nodes.map((node) => {
        if (!node.assignedRunId) return node;
        const job = jobById.get(node.assignedRunId);
        if (!job) return node;
        return { ...node, status: graphStatusFromJob(job) };
      })
    };
    const checklist = updateChecklistForJobs(workItem.checklist ?? [], graph.nodes);
    return {
      ...workItem,
      status: workStatusFromGraph(graph.nodes),
      graph,
      checklist,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Hand off a completed work item to a pull request.
   * Transitions through: committing → pushing → creating_pr → watching_ci → ready_for_review.
   * Returns the updated work item at whatever stage it reaches.
   */
  async handoffToPR(
    repoRoot: string,
    workItem: WorkItem,
    options: { draft?: boolean; base?: string } = {}
  ): Promise<WorkItem> {
    let item = { ...workItem };

    // 1. Ensure branch exists
    if (!item.branch) {
      const branch = await prepareWorkItemBranch(repoRoot, item, item.id, item.externalTask);
      item = { ...item, branch: branch.branchName, updatedAt: new Date().toISOString() };
    }

    const appliedFiles = item.appliedFiles ?? [];
    if (appliedFiles.length === 0) {
      return { ...item, status: "failed", updatedAt: new Date().toISOString() };
    }

    // 2. Commit
    item = { ...item, status: "committing", updatedAt: new Date().toISOString() };
    const commitPlan = await commitWorkItemChanges(repoRoot, item, appliedFiles, { push: false });
    item = {
      ...item,
      commitHash: commitPlan.subject,
      appliedFiles: commitPlan.filesChanged,
      updatedAt: new Date().toISOString()
    };

    // 3. Push (transition to pushing status)
    item = { ...item, status: "pushing", updatedAt: new Date().toISOString() };
    await commitWorkItemChanges(repoRoot, item, appliedFiles, { push: true });
    item = { ...item, updatedAt: new Date().toISOString() };

    // 4. Create PR
    item = { ...item, status: "creating_pr", updatedAt: new Date().toISOString() };
    const prPlan = generateWorkItemPRBody(item, item.branch!, appliedFiles, {
      draft: options.draft ?? true,
      base: options.base
    });
    const pr = await createGhPR(repoRoot, {
      title: prPlan.title,
      head: prPlan.head,
      base: prPlan.base,
      draft: prPlan.draft,
      body: prPlan.body
    });
    item = {
      ...item,
      status: "watching_ci",
      pullRequest: {
        provider: "github",
        number: pr.number,
        url: pr.url,
        branch: pr.branch,
        base: pr.base
      },
      updatedAt: new Date().toISOString()
    };

    // 5. Watch CI — initial check
    const ciResult = await watchCiForWorkItem(item, repoRoot);
    item = {
      ...item,
      ci: {
        lastCheckedAt: new Date().toISOString(),
        status: ciResult.status,
        summary: ciResult.summary,
        failingChecks: ciResult.failingChecks,
        repairAttempts: 0,
        maxRepairAttempts: 2
      },
      status: ciResult.status === "passing" ? "ready_for_review" : "watching_ci",
      updatedAt: new Date().toISOString()
    };

    return item;
  }
}

function selectExecutableNodes(workItem: WorkItem, nodeId: string | undefined, maxNodes: number): ExecutionGraphNode[] {
  const nodes = workItem.graph?.nodes ?? [];
  const candidates = nodeId ? nodes.filter((node) => node.id === nodeId) : nodes;
  return candidates
    .filter((node) => node.status === "pending" || node.status === "failed")
    .filter((node) => dependenciesCompleted(node, nodes))
    .slice(0, Math.max(1, maxNodes));
}

function dependenciesCompleted(node: ExecutionGraphNode, nodes: ExecutionGraphNode[]): boolean {
  return node.dependsOn.every((dependencyId) => nodes.find((candidate) => candidate.id === dependencyId)?.status === "completed");
}

function buildNodePrompt(workItem: WorkItem, node: ExecutionGraphNode): string {
  return [
    `Workspace Work Item: ${workItem.title}`,
    workItem.description ? `Description: ${workItem.description}` : "",
    `Work item id: ${workItem.id}`,
    `Graph node: ${node.id} (${node.kind})`,
    `Node goal: ${node.goal}`,
    `Expected output: ${workItem.expectedOutput}`,
    `Risk: ${workItem.assessment?.risk ?? workItem.risk}`,
    workItem.assessment?.affectedAreas.length ? `Affected areas: ${workItem.assessment.affectedAreas.join(", ")}` : "",
    "Execute only this graph node. Do not skip existing approval, review, or tool-check gates."
  ].filter(Boolean).join("\n");
}

function workflowModeForNode(workItem: WorkItem, node: ExecutionGraphNode): WorkflowMode {
  if (node.kind === "review" || node.kind === "inspect" || node.kind === "check") return "review";
  if (node.kind === "ci_fix") return "fix";
  if (node.kind === "implement") return workItem.type === "refactor" ? "refactor" : "implement";
  if (node.kind === "test") return "standard";
  return workItem.expectedOutput === "pull_request" ? "review" : "standard";
}

function updateChecklistForAssignments(items: ChecklistItem[], assignments: WorkNodeRunAssignment[]): ChecklistItem[] {
  const assignmentByNode = new Map(assignments.map((assignment) => [assignment.nodeId, assignment.runId]));
  return items.map((item) => {
    const runId = assignmentByNode.get(item.id);
    return runId ? { ...item, status: "doing" as const, evidence: { type: "run" as const, ref: runId } } : item;
  });
}

function updateChecklistForJobs(items: ChecklistItem[], nodes: ExecutionGraphNode[]): ChecklistItem[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return items.map((item) => {
    const node = nodeById.get(item.id);
    if (!node?.assignedRunId) return item;
    if (node.status === "completed") return { ...item, status: "passed" as const, evidence: { type: "run" as const, ref: node.assignedRunId } };
    if (node.status === "failed" || node.status === "skipped") return { ...item, status: "failed" as const, evidence: { type: "run" as const, ref: node.assignedRunId } };
    if (node.status === "running") return { ...item, status: "doing" as const, evidence: { type: "run" as const, ref: node.assignedRunId } };
    return item;
  });
}

function graphStatusFromJob(job: QueueJob): ExecutionGraphNode["status"] {
  if (job.status === "completed") return "completed";
  if (job.status === "failed") return "failed";
  if (job.status === "cancelled") return "skipped";
  if (job.status === "queued" || job.status === "running" || job.status === "waiting_for_approval" || job.status === "cancel_requested") return "running";
  return "pending";
}

function workStatusFromGraph(nodes: ExecutionGraphNode[]): WorkItem["status"] {
  if (nodes.some((node) => node.status === "failed")) return "failed";
  if (nodes.some((node) => node.status === "running")) return "executing";
  if (nodes.length > 0 && nodes.every((node) => node.status === "completed" || node.status === "skipped")) return "done";
  return "planning";
}
