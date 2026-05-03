import type {
  ArtifactSummary,
  ApprovalPolicyDecision,
  ContextSelectionCandidate,
  ExecutionSummary,
  ExecutionTransition,
  FileGenerationResult,
  IterationResult,
  MemoryStats,
  PlanResult,
  ProviderSummary,
  ReviewIssue,
  RoutingDecision,
  ToolExecutionResult,
  VectorSearchMatch,
  ExternalTaskRef,
  ExternalTaskUpdatePreview,
  RefactorAnalysis,
  TaskContract
} from "../types.js";

export interface ArtifactState {
  enabled: boolean;
  repoRoot: string;
  baseDir: string;
  runDir: string | null;
  latestIterationPath: string | null;
  stepPaths: Record<string, string>;
}

export interface PersistedRunState {
  version: number;
  status?: string;
  task?: string;
  dryRun?: boolean;
  plan: PlanResult;
  result?: FileGenerationResult | null;
  iterations?: IterationResult[];
  skippedContextFiles?: string[];
  finalIssues?: ReviewIssue[];
  latestReviewSummary?: string;
  pauseAfterGenerate?: boolean;
  memory?: Partial<MemoryStats>;
  artifacts?: ArtifactSummary | null;
  diffSummaries?: import("../types.js").DiffSummary[];
  latestToolResults?: ToolExecutionResult[];
  latestVectorMatches?: VectorSearchMatch[];
  latestContextRanking?: ContextSelectionCandidate[];
  execution?: ExecutionSummary | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  executionTransitions?: ExecutionTransition[];
  externalTask?: ExternalTaskRef;
  externalUpdatePreviews?: ExternalTaskUpdatePreview[];
  refactorAnalysis?: RefactorAnalysis;
  contracts?: TaskContract[];
}

export interface RecentRunSummary {
  statePath: string;
  runState: PersistedRunState & {
    status?: string;
    task?: string;
    issueCounts?: Record<string, number>;
    providers?: ProviderSummary;
    latestToolResults?: ToolExecutionResult[];
    latestVectorMatches?: VectorSearchMatch[];
    latestContextRanking?: ContextSelectionCandidate[];
    execution?: ExecutionSummary | null;
    approvalPolicy?: ApprovalPolicyDecision | null;
    executionTransitions?: ExecutionTransition[];
    externalTask?: ExternalTaskRef;
    externalUpdatePreviews?: ExternalTaskUpdatePreview[];
  };
  artifactIndex: {
    updatedAt?: string;
    runPath?: string;
    latestIterationPath?: string | null;
    latestStep?: string;
    latestStatus?: string | null;
    latestTask?: string | null;
    latestProvider?: string | null;
    latestFiles?: string[];
    diffSummaries?: import("../types.js").DiffSummary[];
    latestToolResults?: ToolExecutionResult[];
    latestVectorMatches?: VectorSearchMatch[];
    latestContextRanking?: ContextSelectionCandidate[];
    iterationCount?: number;
    stepPaths?: Record<string, string>;
    execution?: ExecutionSummary | null;
    approvalPolicy?: ApprovalPolicyDecision | null;
    latestApplyEventPath?: string | null;
    lastAppliedAt?: string | null;
    applyEventCount?: number;
    externalTask?: ExternalTaskRef;
    externalUpdatePreviews?: ExternalTaskUpdatePreview[];
    refactorAnalysis?: RefactorAnalysis;
  } | null;
  routing: {
    planning: RoutingDecision | null;
    implementation: RoutingDecision | null;
  };
}

export interface RunListEntry {
  statePath: string;
  runPath: string;
  runName: string;
  status: string;
  task: string;
  dryRun: boolean;
  updatedAt: string | null;
  iterationCount: number;
  latestFiles: string[];
  diffSummaries?: import("../types.js").DiffSummary[];
  latestToolResults?: import("../types.js").ToolExecutionResult[];
  execution: ExecutionSummary | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
  latestApplyEventPath?: string | null;
  lastAppliedAt?: string | null;
  applyEventCount: number;
  externalTask?: ExternalTaskRef;
  externalUpdatePreviews?: ExternalTaskUpdatePreview[];
  refactorAnalysis?: RefactorAnalysis;
  contracts?: TaskContract[];
}

export interface ApplyEventRecord {
  version: number;
  savedAt: string;
  task: string;
  dryRun: boolean;
  force: boolean;
  wroteFiles: boolean;
  appliedFiles: string[];
  reviewSummary: string;
  issueCounts: Record<"high" | "medium" | "low", number>;
  runPath: string;
  iterationPath: string;
  manifestPath: string;
}
