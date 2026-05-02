import type {
  RiskClass,
  RiskSignal,
  ExternalTaskRef
} from "../types.js";

export type WorkItemStatus =
  | "created"
  | "assessing"
  | "decomposing"
  | "planning"
  | "waiting_plan_approval"
  | "executing"
  | "running_checks"
  | "fixing_failures"
  | "reviewing"
  | "waiting_generation_approval"
  | "committing"
  | "pushing"
  | "creating_pr"
  | "watching_ci"
  | "ready_for_review"
  | "done"
  | "failed"
  | "cancelled";

export type WorkItemType =
  | "bugfix"
  | "feature"
  | "refactor"
  | "test"
  | "docs"
  | "investigation"
  | "review";

export type WorkItemSource =
  | "manual"
  | "github_issue"
  | "github_pr"
  | "ci_failure"
  | "api"
  | "webhook";

export type ExpectedOutput = "report" | "patch" | "branch" | "pull_request";

export interface TaskAssessment {
  complexity: "small" | "medium" | "large";
  risk: RiskClass;
  confidence: number;
  affectedAreas: string[];
  requiresBranch: boolean;
  requiresHumanApproval: boolean;
  requiresFullTestSuite: boolean;
  tokenBudget?: number;
  modelTier?: number;
  modelCallReason?: string;
  reason: string;
  signals: RiskSignal[];
}

export type ExecutionGraphNodeKind =
  | "inspect"
  | "test"
  | "implement"
  | "check"
  | "review"
  | "commit"
  | "pr"
  | "ci_fix";

export type ExecutionGraphNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ExecutionGraphNode {
  id: string;
  kind: ExecutionGraphNodeKind;
  title: string;
  goal: string;
  status: ExecutionGraphNodeStatus;
  dependsOn: string[];
  assignedRunId?: string;
}

export type ExecutionGraphEdgeKind = "dependency" | "blocker" | "validation";

export interface ExecutionGraphEdge {
  from: string;
  to: string;
  kind: ExecutionGraphEdgeKind;
}

export interface ExecutionGraph {
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
}

export type ChecklistItemStatus = "todo" | "doing" | "passed" | "failed" | "waived";

export interface EvidenceRef {
  type: "file" | "check" | "artifact" | "run" | "commit" | "pr" | "review" | "approval" | "audit";
  ref: string;
  metadata?: Record<string, unknown>;
}

export interface ChecklistItem {
  id: string;
  text: string;
  required: boolean;
  status: ChecklistItemStatus;
  evidence?: EvidenceRef;
  waivedBy?: string;
  waiveReason?: string;
  waivedAt?: string;
}

export interface WorkItem {
  schemaVersion: number;
  id: string;
  projectId: string;
  title: string;
  description: string;
  source: WorkItemSource;
  type: WorkItemType;
  status: WorkItemStatus;
  risk: RiskClass;
  expectedOutput: ExpectedOutput;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  externalTask?: ExternalTaskRef;
  linkedRuns: string[];
  branch?: string;
  worktreePath?: string;
  pullRequest?: {
    provider: string;
    number: number;
    url: string;
    branch: string;
    base: string;
  };
  assessment?: TaskAssessment;
  graph?: ExecutionGraph;
  checklist?: ChecklistItem[];
}
