import type { DiffSummary, FailureMetadata, ToolExecutionResult } from "../../types.js";

export type WorkerProviderId = "codex" | "dummy";

export interface WorkerProviderExecutionInput {
  jobId: string;
  task: string;
  cwd: string;
  worktreePath: string;
  workspaceRoot: string;
  artifactDir: string;
  dryRun: boolean;
  workflowMode?: string;
  workflowProfile?: string;
  approvalPolicy?: unknown;
  env: Record<string, string>;
  signal?: AbortSignal;
}

export interface WorkerProviderExecutionResult {
  ok: boolean;
  summary: string;
  stdout: string;
  stderr: string;
  changedFiles: string[];
  diffText?: string;
  artifactPath?: string;
  workerLogs?: string[];
  diffSummaries?: DiffSummary[];
  latestToolResults?: ToolExecutionResult[];
  failure?: FailureMetadata;
}

export interface WorkerProviderAdapter {
  id: WorkerProviderId;
  isAvailable(input: WorkerProviderExecutionInput): Promise<boolean>;
  execute(input: WorkerProviderExecutionInput): Promise<WorkerProviderExecutionResult>;
}
