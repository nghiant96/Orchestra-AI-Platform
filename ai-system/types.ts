export type JsonSchema =
  | {
      type?: string;
      additionalProperties?: boolean;
      properties?: Record<string, JsonSchema>;
      required?: string[];
      items?: JsonSchema;
      enum?: Array<string | number | boolean | null>;
    }
  | undefined;

export type JsonObject = Record<string, unknown>;

export interface ConfirmationHandler {
  confirmPlan(plan: PlanResult): Promise<boolean>;
  confirmCheckpoint(message: string, artifactPath?: string | null): Promise<boolean>;
}

export interface Logger {
  step(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
  dashboard?(snapshot: DashboardSnapshot): void;
  onLog?(level: string, message: string): void;
}

export interface ProviderConfig {
  type: string;
  command?: string;
  model?: string;
  timeout_ms?: number;
  retries?: number;
  base_delay_ms?: number;
  monitor_interval_ms?: number;
  base_url?: string;
  api_key?: string;
  temperature?: number;
  response_format?: JsonObject;
  [key: string]: unknown;
}

export interface ProviderConfigMap extends Record<string, ProviderConfig> {
  planner: ProviderConfig;
  reviewer: ProviderConfig;
  generator: ProviderConfig;
  fixer: ProviderConfig;
}

export type ProviderRole = "planner" | "reviewer" | "generator" | "fixer";

export type RoutingProfileName = "fast" | "balanced" | "safe";

export type ProviderRoutingProfile = Partial<Record<ProviderRole, string>>;

export interface RoutingSignal {
  name: string;
  matched: boolean;
  details?: string;
  scores?: Partial<Record<RoutingProfileName, number>>;
}

export interface RoutingDecision {
  stage: "planning" | "implementation";
  enabled: boolean;
  profile: RoutingProfileName;
  reason: string;
  roleProviders: Record<ProviderRole, string>;
  appliedRoles: Partial<Record<ProviderRole, string>>;
  reasons: string[];
  signals: RoutingSignal[];
}

export type RiskClass = "low" | "medium" | "high" | "blocked";

export interface RiskSignal {
  name: string;
  severity: RiskClass;
  reason: string;
}

export interface ApprovalPolicyDecision {
  riskClass: RiskClass;
  riskScore: number;
  signals: RiskSignal[];
  approvalMode: "auto" | "manual";
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  reason: string;
}

export interface RoutingConfig {
  enabled?: boolean;
  default_profile?: RoutingProfileName | string;
  locked_roles?: string[];
  profiles?: Record<string, ProviderRoutingProfile>;
  adaptive?: {
    enabled?: boolean;
    lookback_runs?: number;
    min_samples?: number;
    failure_weight?: number;
    planner_weight?: number;
    reviewer_weight?: number;
    generator_weight?: number;
    fixer_weight?: number;
    role_override_threshold?: number;
    duration_budget_penalty?: number;
    cost_budget_penalty?: number;
    [key: string]: unknown;
  };
  heuristics?: {
    fast?: string[];
    safe?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type ToolExecutionName = "json-validation" | "lint" | "typecheck" | "build" | "test" | (string & {});
export type ToolExecutionKind = "validation" | "command";
export type ToolExecutionScope = "full" | "changed-files" | "package" | "workspace";
export type ToolSandboxMode = "inherit" | "clean-env" | "docker";
export type ToolSandboxImageProfile = "auto" | "node" | "python" | "go" | "rust" | (string & {});

export interface ToolSandboxConfig {
  mode?: ToolSandboxMode;
  image?: string;
  image_profile?: ToolSandboxImageProfile;
  auto_build?: boolean;
  dockerfile?: string;
  include_env?: string[];
  extra_env?: Record<string, string>;
  [key: string]: unknown;
}

export interface ToolCommandConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
  script?: string;
  append_changed_files?: boolean;
  timeout_ms?: number;
  retries?: number;
  base_delay_ms?: number;
  [key: string]: unknown;
}

export type ToolProjectType = "auto" | "node" | "python" | "go" | "rust" | (string & {});

export interface ToolAdapterConfig {
  enabled?: boolean;
  detect_files?: string[];
  commands?: Partial<Record<ToolExecutionName, ToolCommandConfig>>;
  changed_file_extensions?: string[];
  working_directory?: string;
  [key: string]: unknown;
}

export interface ToolExecutionConfig {
  enabled?: boolean;
  json_validation?: boolean;
  sandbox?: ToolSandboxConfig;
  commands?: Partial<Record<ToolExecutionName, ToolCommandConfig>>;
  project_type?: ToolProjectType;
  adapters?: Record<string, ToolAdapterConfig>;
  [key: string]: unknown;
}

export interface ToolExecutionResult {
  name: ToolExecutionName;
  kind: ToolExecutionKind;
  ok: boolean;
  skipped: boolean;
  issueCount: number;
  durationMs: number;
  summary: string;
  command?: string;
  args?: string[];
  scope?: ToolExecutionScope;
  sandboxMode?: ToolSandboxMode;
  sandboxImage?: string;
  sandboxImageProfile?: string;
  workingDirectory?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface ToolExecutionSummary {
  results: ToolExecutionResult[];
  issues: ReviewIssue[];
}

export interface ToolConfigurationSummary {
  name: ToolExecutionName;
  enabled: boolean;
  source: "configured-command" | "configured-script" | "auto-detected-script" | "adapter" | "fallback" | "disabled" | "none";
  command?: string;
  args?: string[];
  scopedToChangedFiles?: boolean;
  scope?: ToolExecutionScope;
  sandboxMode?: ToolSandboxMode;
  sandboxImage?: string;
  sandboxImageProfile?: string;
  workingDirectory?: string;
  summary: string;
}

export type ExecutionStepStatus = "completed" | "failed" | "paused" | "skipped";
export type ExecutionTransitionStatus = "entered" | ExecutionStepStatus | "cancelled";
export type ExecutionStage =
  | "routing-planning"
  | "project-tree"
  | "planning-memory"
  | "planner"
  | "context-expansion"
  | "routing-implementation"
  | "implementation-memory"
  | "context"
  | "context-restore"
  | "iteration-generate"
  | "iteration-tools"
  | "iteration-review"
  | "iteration-fix"
  | "write-files"
  | "memory-store"
  | "cancelled"
  | "success"
  | "failure"
  | "paused";
export type FailureClass =
  | "paused"
  | "cancelled"
  | "tool-check-failed"
  | "validation-failed"
  | "duration-budget-exceeded"
  | "cost-budget-exceeded"
  | "iteration-limit"
  | "review-blocking-issues"
  | "unknown"
  | "provider-timeout"
  | "provider-error"
  | "tool-execution-failed"
  | "context-overflow"
  | "user-cancelled"
  | "internal-error";

export type LegacyFailureClass =
  | "provider_timeout"
  | "provider_error"
  | "tool_execution_failed"
  | "context_overflow"
  | "budget_exceeded"
  | "validation_failed"
  | "user_cancelled"
  | "internal_error";

export interface ExecutionStepSummary {
  name: string;
  durationMs: number;
  status: ExecutionStepStatus;
  detail?: string;
}

export interface ExecutionTransition {
  stage: ExecutionStage;
  status: ExecutionTransitionStatus;
  timestamp: string;
  durationMs?: number;
  detail?: string;
  iteration?: number;
  metadata?: Record<string, unknown>;
}

export interface FailureSummary {
  class: FailureClass | LegacyFailureClass;
  reason: string;
}

export interface RetryHint {
  stage: ExecutionStage;
  iteration?: number;
  reason: string;
}

export interface ExecutionBudgetConfig {
  max_duration_ms?: number;
  max_cost_units?: number;
  max_daily_cost_units?: number;
  max_single_run_cost_units?: number;
}

export interface ExecutionBudgetSummary {
  maxDurationMs: number | null;
  maxCostUnits: number | null;
  totalDurationMs: number;
  totalCostUnits: number;
  exceeded: "duration" | "cost" | null;
}

export interface ProviderUsageMetric {
  role: ProviderRole;
  provider: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUnits: number;
}

export interface ExecutionProviderMetric {
  provider: string;
  role: ProviderRole;
  stages: ExecutionStage[];
  totalDurationMs: number;
  estimatedCostUnits: number;
}

export interface FailureMetadata {
  class: FailureClass | LegacyFailureClass;
  message: string;
  detail?: string;
  step?: string;
  retryable: boolean;
  suggestion?: string;
}

export interface ExecutionSummary {
  totalDurationMs: number;
  steps: ExecutionStepSummary[];
  transitions: ExecutionTransition[];
  currentStage: ExecutionStage | null;
  terminalStage: ExecutionStage | null;
  failure: FailureSummary | null;
  retryHint?: RetryHint | null;
  providerMetrics?: ExecutionProviderMetric[];
  budget?: ExecutionBudgetSummary | null;
}

export interface DashboardSnapshot {
  message?: string;
  transition?: ExecutionTransition;
  providerMetrics?: ExecutionProviderMetric[];
  budget?: ExecutionBudgetSummary | null;
  diffSummaries?: DiffSummary[];
  artifactPath?: string | null;
  currentFiles?: string[];
}

export interface MemoryConfig {
  enabled?: boolean;
  backend?: string;
  data_dir?: string;
  max_results?: number;
  max_prompt_chars?: number;
  max_entries?: number;
  transport?: string;
  base_url?: string;
  api_key?: string;
  command?: string;
  health_timeout_ms?: number;
  query_timeout_ms?: number;
  store_timeout_ms?: number;
  request_timeout_ms?: number;
  user_id?: string;
  fallback_scan_limit?: number;
  [key: string]: unknown;
}

export interface RulesConfig {
  max_iterations: number;
  max_files: number;
  max_write_files?: number;
  token_limit_hint?: number;
  max_tree_entries?: number;
  max_context_bytes: number;
  request_timeout_ms: number;
  request_retries: number;
  retry_base_delay_ms: number;
  execution?: {
    budgets?: ExecutionBudgetConfig;
    [key: string]: unknown;
  };
  artifacts?: {
    enabled?: boolean;
    data_dir?: string;
    [key: string]: unknown;
  };
  retention?: {
    artifacts_days?: number;
    audit_days?: number;
    queue_days?: number;
    logs_days?: number;
  };
  memory: MemoryConfig;
  vector_search?: VectorSearchConfig;
  providers: ProviderConfigMap;
  routing?: RoutingConfig;
  tools?: ToolExecutionConfig;
  prompts?: PromptOverrideConfig;
  excluded_directories?: string[];
  sensitive_file_names?: string[];
  [key: string]: unknown;
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  tools?: Record<string, ToolCommandConfig>;
  adapters?: Record<string, ToolAdapterConfig>;
  prompts?: {
    planner?: string;
    generator?: string;
    reviewer?: string;
  };
}

export interface PluginInfo extends PluginManifest {
  path: string;
  enabled: boolean;
  error?: string;
}

export interface RunJsonOptions {
  cwd: string;
  label: string;
  systemPrompt: string;
  prompt: string;
  schema: JsonSchema;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

export interface JsonProvider {
  id: string;
  runJson<T = unknown>(options: RunJsonOptions): Promise<T>;
  getUsage?(): ProviderUsageMetric[];
}

export interface AgentDependencies {
  provider: JsonProvider;
  rules: RulesConfig;
}

export interface ContextFile {
  path: string;
  content: string;
}

export interface GeneratedFile {
  path: string;
  action?: "create" | "update";
  content: string;
}

export interface DiffSummary {
  path: string;
  beforeLineCount: number;
  afterLineCount: number;
  addedLines: number;
  removedLines: number;
  changedLineEstimate: number;
}

export interface ReviewIssue {
  severity: "high" | "medium" | "low";
  category: string;
  path: string;
  description: string;
  suggestedFix: string;
}

export interface ReviewResult {
  summary: string;
  issues: ReviewIssue[];
}

export type TaskContractSeverity = "high" | "medium" | "low";
export type TaskContractStatus = "pending" | "passed" | "failed" | "unknown";
export type TaskContractCheckStrategy = "deterministic" | "review" | "tool";

export interface TaskContract {
  id: string;
  description: string;
  severity: TaskContractSeverity;
  status: TaskContractStatus;
  checkStrategy: TaskContractCheckStrategy;
  targetPaths: string[];
  suggestedFix?: string;
}

export interface PlanResult {
  prompt: string;
  readFiles: string[];
  writeTargets: string[];
  notes: string[];
  contracts?: TaskContract[];
}

export interface FileGenerationResult {
  summary: string;
  files: GeneratedFile[];
}

export interface IterationResult {
  iteration: number;
  summary: string;
  issues: ReviewIssue[];
  toolResults?: ToolExecutionResult[];
  durationMs?: number;
  artifactPath?: string | null;
}

export interface ProviderSummary {
  planner: string;
  reviewer: string;
  generator: string;
  fixer: string;
}

export interface MemoryStats {
  backend: string;
  planningMatches: number;
  implementationMatches: number;
  stored: boolean;
}

export interface ArtifactSummary {
  enabled: boolean;
  ok: boolean;
  runPath: string;
  latestIterationPath: string | null;
  stepPaths: Record<string, string>;
  latestFiles: string[];
  latestToolResults?: ToolExecutionResult[];
  latestVectorMatches?: VectorSearchMatch[];
  latestContextRanking?: ContextSelectionCandidate[];
  execution?: ExecutionSummary | null;
}

export interface VectorSearchConfig {
  enabled?: boolean;
  data_dir?: string;
  max_results?: number;
  max_indexed_files?: number;
  max_file_bytes?: number;
  chunk_size?: number;
  chunk_overlap?: number;
  ignore_patterns?: string[];
  parsers?: VectorParserConfig;
  [key: string]: unknown;
}

export type VectorParserMode = "auto" | "typescript-only" | "line-based" | "tree-sitter";

export interface VectorParserConfig {
  mode?: VectorParserMode;
  tree_sitter_languages?: string[];
  [key: string]: unknown;
}

export type PromptTemplateName = "planner" | "generator" | "reviewer" | "fixer";

export interface PromptOverrideConfig {
  directory?: string;
  templates?: Partial<Record<PromptTemplateName, string>>;
  examples_directory?: string;
  allowed_roots?: string[];
  base_dir?: string;
  [key: string]: unknown;
}

export interface VectorSearchMatch {
  id: string;
  path: string;
  score: number;
  startLine: number;
  endLine: number;
  preview: string;
}

export interface ContextSelectionCandidate {
  path: string;
  score: number;
  sources: string[];
}

export type RunStatus =
  | "cancelled"
  | "paused_after_plan"
  | "paused_after_generate"
  | "completed"
  | "failed"
  | "resumed_completed";

export interface OrchestratorResult {
  ok: boolean;
  status?: RunStatus;
  dryRun: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  result: FileGenerationResult | null;
  iterations: IterationResult[];
  issueCounts: Record<string, number>;
  skippedContextFiles: string[];
  finalIssues: ReviewIssue[];
  providers: ProviderSummary;
  memory: MemoryStats;
  artifacts: ArtifactSummary | null;
  wroteFiles: boolean;
  diffSummaries?: DiffSummary[];
  latestToolResults?: ToolExecutionResult[];
  execution?: ExecutionSummary | null;
  approvalPolicy?: ApprovalPolicyDecision | null;
}

export interface MemoryMatch {
  id: string;
  kind: string;
  createdAt: string;
  score: number;
  summary: string;
  files: string[];
  task: string;
  outcome: string;
}

export interface MemorySearchInput {
  task: string;
  stage: string;
  plan?: PlanResult | null;
}

export interface MemoryStoreInput {
  task: string;
  plan: PlanResult;
  result: FileGenerationResult | null;
  iterations: Array<{ summary?: string; issues?: ReviewIssue[] }>;
  issueCounts: Record<string, number>;
  providers: ProviderSummary;
  success: boolean;
  dryRun: boolean;
}

export interface MemoryAdapter {
  id: string;
  searchRelevant(input: MemorySearchInput): Promise<MemoryMatch[]>;
  formatForPrompt(memories: MemoryMatch[], stage: string): string;
  storeRunSummary(input: MemoryStoreInput): Promise<boolean>;
}

export interface CommandRunOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  killGraceMs?: number;
  monitorIntervalMs?: number;
  onMonitor?: (event: CommandMonitorEvent) => void;
  signal?: AbortSignal;
}

export interface CommandRetryOptions extends CommandRunOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
}

export interface CommandMonitorEvent {
  command: string;
  args: string[];
  cwd: string;
  elapsedMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  monitorId: number;
  attempt?: number;
}

export interface CommandRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface CliCommandError extends Error {
  code?: string | number | null;
  stdout?: string;
  stderr?: string;
  status?: number;
  responseText?: string;
}
