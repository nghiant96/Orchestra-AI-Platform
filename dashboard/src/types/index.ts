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
