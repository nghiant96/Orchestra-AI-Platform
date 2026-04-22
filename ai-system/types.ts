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

export interface Logger {
  step(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
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
  artifacts?: {
    enabled?: boolean;
    data_dir?: string;
    [key: string]: unknown;
  };
  memory: MemoryConfig;
  providers: ProviderConfigMap;
  excluded_directories?: string[];
  sensitive_file_names?: string[];
  [key: string]: unknown;
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
}

export interface JsonProvider {
  id: string;
  runJson<T = unknown>(options: RunJsonOptions): Promise<T>;
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

export interface PlanResult {
  prompt: string;
  readFiles: string[];
  writeTargets: string[];
  notes: string[];
}

export interface FileGenerationResult {
  summary: string;
  files: GeneratedFile[];
}

export interface IterationResult {
  iteration: number;
  summary: string;
  issues: ReviewIssue[];
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
  input?: string;
  timeoutMs?: number;
  killGraceMs?: number;
  monitorIntervalMs?: number;
  onMonitor?: (event: CommandMonitorEvent) => void;
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
