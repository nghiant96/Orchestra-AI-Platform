export interface ExecutionTransition {
  stage: string;
  status: string;
  timestamp: string;
  detail?: string;
  iteration?: number;
}

export interface ProviderMetric {
  provider: string;
  role: string;
  totalDurationMs: number;
  estimatedCostUnits: number;
}

export interface ToolResult {
  name: string;
  kind: string;
  ok: boolean;
  skipped: boolean;
  issueCount: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  summary: string;
  command?: string;
}

export interface DiffSummary {
  path: string;
  beforeLineCount: number;
  afterLineCount: number;
  addedLines: number;
  removedLines: number;
  changedLineEstimate: number;
}

export interface FailureMetadata {
  class: string;
  message: string;
  detail?: string;
  retryable: boolean;
  suggestion?: string;
}

export interface RetryHint {
  stage: string;
  iteration?: number;
  reason: string;
}

export interface ApprovalPolicyDecision {
  riskClass: 'low' | 'medium' | 'high' | 'blocked';
  riskScore: number;
  signals: Array<{
    name: string;
    severity: 'low' | 'medium' | 'high' | 'blocked';
    reason: string;
  }>;
  approvalMode: 'manual' | 'auto';
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  reason: string;
}

export interface TaskContract {
  id: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  status: 'pending' | 'passed' | 'failed' | 'unknown';
  checkStrategy: 'deterministic' | 'review' | 'tool';
  targetPaths: string[];
  suggestedFix?: string;
  source?: 'deterministic' | 'llm';
  explanation?: string;
}

export interface ReviewIssue {
  severity: 'high' | 'medium' | 'low';
  category: string;
  path: string;
  line?: number;
  description: string;
  risk?: string;
  suggestedFix: string;
  verificationCommand?: string;
  affectedFiles?: string[];
}

export interface Job {
  jobId: string;
  status: 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
  task: string;
  cwd: string;
  dryRun: boolean;
  resume?: boolean;
  approvalMode?: 'manual' | 'auto';
  approvalPolicy?: ApprovalPolicyDecision;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  artifactPath?: string | null;
  resultSummary?: string | null;
  error?: string | null;
  failure?: FailureMetadata;
  diffSummaries?: DiffSummary[];
  latestToolResults?: ToolResult[];
  execution?: {
    transitions?: ExecutionTransition[];
    providerMetrics?: ProviderMetric[];
    totalDurationMs?: number;
    budget?: {
      maxDurationMs: number | null;
      maxCostUnits: number | null;
      totalDurationMs: number;
      totalCostUnits: number;
      exceeded: 'duration' | 'cost' | null;
    } | null;
    pendingPlan?: {
      prompt: string;
      readFiles: string[];
      writeTargets: string[];
      notes: string[];
      contracts?: TaskContract[];
    };
    retryHint?: RetryHint | null;
  };
}

export interface WorkspaceStats {
  ok?: boolean;
  version?: number;
  totalProjectCost: number;
  totalRuns: number;
  avgWaitTimeMs: number;
  avgExecutionTimeMs: number;
  queueLatency?: {
    totalQueueRecords: number;
    avgWaitTimeMs: number;
    avgExecutionTimeMs: number;
    retryRate: number;
  };
  avgIterations: number;
  costByDay: { date: string; cost: number }[];
  failuresByClass: { name: string; count: number }[];
  avgDurationByStage: { stage: string; avgMs: number }[];
  providerPerformance?: {
    provider: string;
    runs: number;
    failureRate: number;
    avgDurationMs: number;
    avgIterations?: number;
    totalCostUnits: number;
    degraded?: boolean;
  }[];
  contractStats?: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    byDomain: { domain: string; total: number; passed: number; failed: number; passRate: number }[];
  };
  audit?: {
    retentionDays: number;
  };
}

export interface WorkItem {
  schemaVersion: number;
  id: string;
  projectId: string;
  title: string;
  description: string;
  source: 'manual' | 'github_issue' | 'github_pr' | 'ci_failure' | 'api' | 'webhook';
  type: 'bugfix' | 'feature' | 'refactor' | 'test' | 'docs' | 'investigation' | 'review';
  status: string;
  risk: 'low' | 'medium' | 'high' | 'blocked';
  expectedOutput: 'report' | 'patch' | 'branch' | 'pull_request';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  linkedRuns: string[];
  branch?: string;
  worktreePath?: string;
  pullRequest?: {
    provider: string;
    number: number;
    url: string;
    branch: string;
    base: string;
    html_url?: string;
  };
  ci?: {
    lastCheckedAt?: string;
    status?: 'passing' | 'failing' | 'unknown';
    summary?: string;
    failingChecks?: string[];
    repairAttempts?: number;
    maxRepairAttempts?: number;
  };
  checks?: Array<{
    id: string;
    name: string;
    status: string;
    conclusion: string;
    completed_at?: string;
    html_url?: string;
  }>;
  assessment?: {
    complexity: 'small' | 'medium' | 'large';
    risk: 'low' | 'medium' | 'high' | 'blocked';
    confidence: number;
    affectedAreas: string[];
    requiresBranch: boolean;
    requiresHumanApproval: boolean;
    requiresFullTestSuite: boolean;
    tokenBudget?: number;
    modelTier?: number;
    modelCallReason?: string;
    reason: string;
  };
  graph?: {
    nodes: Array<{ id: string; kind: string; title: string; goal: string; status: string; dependsOn: string[]; assignedRunId?: string }>;
    edges: Array<{ from: string; to: string; kind: string }>;
  };
  checklist?: Array<{
    id: string;
    text: string;
    required: boolean;
    status: string;
    evidence?: {
      type: string;
      ref: string;
      metadata?: Record<string, unknown>;
    };
    waivedBy?: string;
    waiveReason?: string;
    waivedAt?: string;
  }>;
  appliedFiles?: string[];
  commitHash?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  tools?: Record<string, ToolResult>;
  adapters?: Record<string, unknown>;
}

export interface PluginInfo extends PluginManifest {
  path: string;
  enabled: boolean;
  error?: string;
}

export interface SystemConfig {
  rules: {
    max_iterations?: number;
    max_files?: number;
    max_context_bytes?: number;
    skip_approval?: boolean;
    memory?: { backend?: string };
    vector_search?: { enabled?: boolean };
    execution?: { budgets?: { max_cost_units?: number; max_duration_ms?: number; max_daily_cost_units?: number; max_single_run_cost_units?: number } };
    routing?: { enabled?: boolean; adaptive?: { enabled?: boolean } };
    providers?: Record<string, { type?: string; model?: string }>;
    tools?: { enabled?: boolean; json_validation?: boolean };
  };
  profile: string | null;
  globalProfile: string | null;
  plugins: PluginInfo[];
}

export type ViewMode = 'activity' | 'config';

export type ProviderFormMap = Record<string, { model?: string }>;

export interface ConfigFormData {
  max_iterations?: number;
  max_daily_cost_units?: number;
  max_single_run_cost_units?: number;
  skip_approval?: boolean;
  profile: string;
  providers: ProviderFormMap;
}
