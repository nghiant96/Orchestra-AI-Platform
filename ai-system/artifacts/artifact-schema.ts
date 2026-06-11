export type ArtifactMode = "solo" | "team";
export type ArtifactExecutionMode = "quick" | "normal" | "safe";
export type ArtifactStatus = "created" | "running" | "failed" | "completed" | "cancelled" | "reverted";
export type ArtifactGuardStatus = "passed" | "warning" | "failed" | "skipped";
export type ArtifactVerificationStatus = "passed" | "failed" | "skipped";

export interface JobArtifactManifest {
  version: 1;
  jobId: string;
  mode: ArtifactMode;
  executionMode: ArtifactExecutionMode;
  status: ArtifactStatus;
  task: {
    title?: string;
    prompt: string;
    createdAt: string;
  };
  repo: {
    root: string;
    gitCommitBefore: string;
    gitCommitAfter?: string;
    branch?: string;
    worktreePath?: string;
  };
  provider: {
    id: "codex" | "claude" | "local" | string;
    command?: string;
  };
  artifacts: JobArtifactRefs;
  summary?: JobArtifactSummaryData;
}

export interface JobArtifactRefs {
  task?: string;
  phaseState?: string;

  contextPack?: string;
  contextPackMarkdown?: string;
  preContextPack?: string;
  preContextPackMarkdown?: string;
  repoConventions?: string;

  providerStdout?: string;
  providerStderr?: string;
  process?: string;

  diffPatch?: string;
  diffStat?: string;
  changedFiles?: string;

  diffBoundaryCheck?: string;
  namingCheck?: string;

  verification?: string;
}

export interface JobArtifactSummaryData {
  changedFileCount: number;
  guardStatus: ArtifactGuardStatus;
  verificationStatus: ArtifactVerificationStatus;
}

export interface JobArtifactRef {
  jobId: string;
  artifactRoot: string;
  manifestPath: string;
}

export interface JobArtifactSummary {
  jobId: string;
  status: ArtifactStatus;
  mode: ArtifactMode;
  executionMode: ArtifactExecutionMode;
  taskTitle?: string;
  taskPrompt: string;
  createdAt: string;
  artifactRoot: string;
  changedFileCount?: number;
  guardStatus?: ArtifactGuardStatus;
  verificationStatus?: ArtifactVerificationStatus;
}

export interface CreateJobArtifactInput {
  jobId: string;
  mode: ArtifactMode;
  executionMode: ArtifactExecutionMode;
  task: {
    title?: string;
    prompt: string;
    createdAt?: string;
  };
  repo: {
    root: string;
    gitCommitBefore?: string;
    gitCommitAfter?: string;
    branch?: string;
    worktreePath?: string;
  };
  provider: {
    id: string;
    command?: string;
  };
}

export interface ArtifactWriteInput {
  path: string;
  content: string | Buffer;
}

export interface JobListFilter {
  mode?: ArtifactMode;
  status?: ArtifactStatus;
  limit?: number;
}
