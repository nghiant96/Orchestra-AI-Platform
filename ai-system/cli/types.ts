import type { ExecutionStage, OrchestratorResult } from "../types.js";
import type { WorkflowMode } from "../core/workflow-modes.js";

export interface CliOptions {
  cwd: string;
  dryRun: boolean;
  chat: boolean;
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  help: boolean;
  configPath: string | null;
  globalConfig: boolean;
  providerPreset: string | null;
  resumeTarget: string | null;
  command: CliCommand | null;
  outputJson: boolean;
  savePath: string | null;
  workflowMode: WorkflowMode;
  retryStage: ExecutionStage | null;
  reviewStaged: boolean;
  reviewBase: string | null;
  reviewFailingChecks: boolean;
  reviewFiles: string[];
  force: boolean;
  task: string;
}

export type TaskRunOptions = Omit<CliOptions, "chat" | "help" | "command" | "globalConfig" | "savePath">;

export type CliCommand =
  | { kind: "config-show" }
  | { kind: "config-use"; preset: string }
  | { kind: "doctor" }
  | { kind: "explain-routing" }
  | { kind: "fix-checks" }
  | { kind: "fix-from-run"; target: string }
  | { kind: "retry"; target: string }
  | { kind: "setup" }
  | { kind: "setup-check" }
  | { kind: "runs-latest" }
  | { kind: "runs-list" }
  | { kind: "runs-show"; target: string }
  | { kind: "apply-artifact"; target: string }
  | { kind: "work-create"; title: string }
  | { kind: "work-list" }
  | { kind: "work-show"; target: string }
  | { kind: "work-branch"; target: string }
  | { kind: "work-worktree-create"; target: string }
  | { kind: "work-worktree-remove"; target: string }
  | { kind: "work-commit"; target: string; push?: boolean }
  | { kind: "work-pr"; target: string; draft?: boolean; dryRunPr?: boolean }
  | { kind: "work-from-issue"; url: string }
  | { kind: "work-from-pr"; url: string }
  | { kind: "work-inbox-sync" }
  | { kind: "work-ci-watch"; target: string }
  | { kind: "work-ci-fix"; target: string }
  | { kind: "work-schedule" }
  | { kind: "work-metrics" };

export interface InteractiveState {
  cwd: string;
  dryRun: boolean;
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  configPath: string | null;
  providerPreset: string | null;
  resumeTarget: string | null;
}

export interface CurrentChangeReviewResult {
  repoRoot: string;
  configPath: string | null;
  task: string;
  targetMode: "working-tree" | "staged" | "base-ref" | "files";
  targetDetail: string | null;
  targetFiles?: string[];
  changedFiles: string[];
  providers: {
    planner: string;
    reviewer: string;
    generator: string;
    fixer: string;
  };
  latestToolResults: import("../types.js").ToolExecutionResult[];
  reviewSummary: string;
  issues: import("../types.js").ReviewIssue[];
  issueCounts: Record<"high" | "medium" | "low", number>;
  execution: import("../types.js").ExecutionSummary;
}

export interface ArtifactApplyResult {
  repoRoot: string;
  runPath: string;
  iterationPath: string;
  manifestPath: string;
  task: string;
  dryRun: boolean;
  wroteFiles: boolean;
  appliedFiles: string[];
  reviewSummary: string;
  issueCounts: Record<"high" | "medium" | "low", number>;
  force: boolean;
  applyEventPath: string;
}

export interface FailingChecksReviewResult {
  repoRoot: string;
  configPath: string | null;
  task: string;
  changedFiles: string[];
  providers: {
    planner: string;
    reviewer: string;
    generator: string;
    fixer: string;
  };
  latestToolResults: import("../types.js").ToolExecutionResult[];
  reviewSummary: string;
  issues: import("../types.js").ReviewIssue[];
  issueCounts: Record<"high" | "medium" | "low", number>;
  fileHints: string[];
  execution: import("../types.js").ExecutionSummary;
}

export interface FixChecksCommandResult {
  preparation: import("../core/fix-checks.js").FixChecksPreparation;
  result: OrchestratorResult;
}

export type SetupToolName = "lint" | "typecheck" | "build" | "test";
