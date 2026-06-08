import fs from "node:fs/promises";
import path from "node:path";
import type { QueueJob } from "../core/job-queue.js";
import type { DiffSummary, FailureMetadata, ToolExecutionResult } from "../types.js";
import type { Worker } from "../workers/worker-types.js";
import type { WorkerApiClient } from "./worker-client.js";
import { ensurePathWithinRoot, redactWorkerLogLine } from "./worker-safety.js";
import { prepareWorkerWorktree } from "./worker-worktree.js";
import { buildProviderEnv } from "./provider-env.js";
import {
  createFallbackWorkerContextPack,
  loadWorkerContextPack,
  saveWorkerContextPack,
  type WorkerContextPack
} from "./context-pack.js";
import { extractContextPackFromProviderResult } from "./context-pack-parser.js";
import { buildImplementationPromptWithContext } from "./contextual-phase-prompt.js";
import { runDiffBoundaryCheck, writeDiffBoundaryCheckArtifact } from "./diff-boundary-checker.js";
import { runNamingGuard, writeNamingGuardArtifact } from "./naming-guard.js";
import { scanRepoConventions, writeRepoConventionScanArtifact } from "./repo-convention-scanner.js";
import { resolveWorkerProvider } from "./providers/index.js";
import { runWorkerVerification } from "./verification-runner.js";
import {
  ensureWorkerTaskPhaseState,
  getWorkerTaskPhaseResumeIndex,
  loadWorkerTaskPhaseState,
  saveWorkerTaskPhaseState,
  updateWorkerTaskPhaseStateForCompletion,
  updateWorkerTaskPhaseStateForFailure,
  updateWorkerTaskPhaseStateForStart,
  type WorkerTaskPhase,
  type WorkerTaskPhaseState
} from "./task-phases.js";

export interface WorkerJobExecutionContext {
  client: WorkerApiClient;
  worker: Worker;
  job: QueueJob;
  workspaceRoots: string[];
  providerId?: string;
  providerCommand?: string;
  emitLog(message: string): void;
  markFilesystemMutation(stage: string, worktreePath?: string): Promise<void>;
}

export interface WorkerJobExecutionResult {
  ok: boolean;
  summary: string;
  logs: string[];
  filesystemMutated: boolean;
  artifactPath?: string | null;
  diffSummaries?: DiffSummary[];
  latestToolResults?: ToolExecutionResult[];
  failure?: FailureMetadata;
  execution?: QueueJob["execution"];
}

interface MutationInstruction {
  relativePath: string;
  content: string;
}

export async function executeWorkerJob(ctx: WorkerJobExecutionContext): Promise<WorkerJobExecutionResult> {
  const providerId = (ctx.providerId || process.env.ORCHESTRA_WORKER_PROVIDER || "codex").trim().toLowerCase();
  if (providerId !== "dummy") {
    return executeProviderWorkerJob(ctx, providerId);
  }
  return executeDummyWorkerJob(ctx);
}

async function executeDummyWorkerJob(ctx: WorkerJobExecutionContext): Promise<WorkerJobExecutionResult> {
  const logs: string[] = [];
  const emit = (message: string) => {
    const line = redactWorkerLogLine(message);
    logs.push(line);
    ctx.emitLog(line);
  };

  emit(`claimed job ${ctx.job.jobId}`);
  emit(`task: ${redactWorkerLogLine(ctx.job.task)}`);

  const mutation = parseMutationInstruction(ctx.job.task);
  if (mutation) {
    const workspaceRoot = ctx.workspaceRoots[0] ?? ctx.job.cwd;
    const targetPath = ensurePathWithinRoot(workspaceRoot, path.join(workspaceRoot, mutation.relativePath));

    if (ctx.job.dryRun) {
      emit(`dry-run: would write ${mutation.relativePath}`);
      return {
        ok: true,
        summary: `Dry-run skipped write to ${mutation.relativePath}`,
        logs,
        filesystemMutated: false
      };
    }

    emit(`checkpointing filesystem mutation for ${mutation.relativePath}`);
    await ctx.markFilesystemMutation("apply_patch", workspaceRoot);
    emit(`writing ${mutation.relativePath}`);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, mutation.content, "utf8");
    emit(`wrote ${mutation.relativePath}`);

    return {
      ok: true,
      summary: `Wrote ${mutation.relativePath}`,
      logs,
      filesystemMutated: true
    };
  }

  emit("dummy job completed without filesystem changes");
  return {
    ok: true,
    summary: "No-op worker execution completed.",
    logs,
    filesystemMutated: false
  };
}

async function executeProviderWorkerJob(ctx: WorkerJobExecutionContext, providerId: string): Promise<WorkerJobExecutionResult> {
  const logs: string[] = [];
  const emit = (message: string) => {
    const line = redactWorkerLogLine(message);
    logs.push(line);
    ctx.emitLog(line);
  };

  emit(`claimed job ${ctx.job.jobId}`);
  emit(`provider: ${providerId}`);
  emit(`task: ${redactWorkerLogLine(ctx.job.task)}`);

  let prepared: Awaited<ReturnType<typeof prepareWorkerWorktree>>;
  try {
    prepared = await prepareWorkerWorktree({
      jobId: ctx.job.jobId,
      cwd: ctx.job.cwd,
      workspaceRoots: ctx.workspaceRoots
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare worker worktree";
    emit(`worktree preparation failed: ${message}`);
    return {
      ok: false,
      summary: message,
      logs,
      filesystemMutated: false,
      failure: {
        class: "provider-error",
        message,
        step: "worker-worktree",
        retryable: false,
        suggestion: "Ensure the job cwd is a git repository inside the worker workspace roots."
      }
    };
  }

  if (!ctx.job.dryRun) {
    emit(`checkpointing provider filesystem mutation for ${prepared.worktreePath}`);
    await ctx.markFilesystemMutation("provider_execute", prepared.worktreePath);
  }

  const provider = resolveWorkerProvider(providerId, { codexCommand: ctx.providerCommand });
  const providerInputBase = {
    jobId: ctx.job.jobId,
    cwd: ctx.job.cwd,
    worktreePath: prepared.worktreePath,
    workspaceRoot: prepared.workspaceRoot,
    artifactDir: prepared.artifactDir,
    preparedWorktree: prepared,
    dryRun: ctx.job.dryRun,
    workflowMode: ctx.job.workflowMode,
    workflowProfile: ctx.job.workflowProfile,
    approvalPolicy: ctx.job.approvalPolicy,
    env: buildProviderEnv(),
  };

  if (!(await provider.isAvailable({ ...providerInputBase, task: ctx.job.task }))) {
    const message = `Worker provider is not available: ${provider.id}`;
    emit(message);
    return {
      ok: false,
      summary: message,
      logs,
      filesystemMutated: false,
      artifactPath: prepared.artifactDir,
      failure: {
        class: "provider-error",
        message,
        step: `worker-provider:${provider.id}`,
        retryable: true,
        suggestion: "Install/authenticate the provider CLI or configure ORCHESTRA_WORKER_PROVIDER."
      }
    };
  }

  const loadedState = await loadWorkerTaskPhaseState(prepared.artifactDir);
  const { plan, state: initialPhaseState } = ensureWorkerTaskPhaseState(ctx.job.jobId, ctx.job.task, loadedState, {
    workflowProfile: ctx.job.workflowProfile
  });
  let phaseState = initialPhaseState;
  if (!loadedState) {
    await saveWorkerTaskPhaseState(prepared.artifactDir, phaseState);
  }

  const resumeIndex = getWorkerTaskPhaseResumeIndex(phaseState);
  if (resumeIndex > 0) {
    emit(`resuming from phase ${resumeIndex + 1}/${plan.phases.length}`);
  }

  if (!ctx.job.dryRun && plan.phases.length > 0) {
    await ctx.markFilesystemMutation(`phase:${plan.phases[resumeIndex]?.id ?? "initial"}`, prepared.worktreePath);
  }

  let latestResult: Awaited<ReturnType<typeof provider.execute>> | null = null;
  let contextPack: WorkerContextPack | null = await loadWorkerContextPack(prepared.artifactDir);
  const repoConventions = await scanRepoConventions(prepared.worktreePath);
  await writeRepoConventionScanArtifact(prepared.artifactDir, repoConventions);
  for (let index = resumeIndex; index < plan.phases.length; index += 1) {
    const phase = plan.phases[index];
    emit(`phase ${index + 1}/${plan.phases.length}: ${phase.title}`);
    phaseState = updateWorkerTaskPhaseStateForStart(phaseState, phase.id);
    await saveWorkerTaskPhaseState(prepared.artifactDir, phaseState);

    const phaseTask = phase.kind === "implementation"
      ? buildImplementationPromptWithContext({
          phasePrompt: phase.prompt,
          contextPack
        })
      : phase.prompt;
    if (phase.kind === "implementation" && !contextPack) {
      emit("context pack unavailable for implementation phase; continuing with narrow-change guidance");
    }

    const phaseResult = await provider.execute({
      ...providerInputBase,
      task: phaseTask
    });
    latestResult = phaseResult;
    await persistWorkerPhaseArtifact(prepared.artifactDir, phase, phaseResult);
    for (const line of phaseResult.workerLogs ?? []) {
      emit(line);
    }

    if (!phaseResult.ok) {
      phaseState = updateWorkerTaskPhaseStateForFailure(phaseState, phase.id, phaseResult.summary);
      await saveWorkerTaskPhaseState(prepared.artifactDir, phaseState);
      return {
        ok: false,
        summary: phaseResult.summary,
        logs,
        filesystemMutated: !ctx.job.dryRun,
        artifactPath: phaseResult.artifactPath ?? prepared.artifactDir,
        diffSummaries: phaseResult.diffSummaries,
        latestToolResults: phaseResult.latestToolResults,
        failure: phaseResult.failure
      };
    }

    if (phase.kind === "setup") {
      contextPack = extractContextPackFromProviderResult(
        [
          phaseResult.stdout,
          phaseResult.stderr,
          phaseResult.summary,
          ...(phaseResult.workerLogs ?? [])
        ].join("\n"),
        { jobId: ctx.job.jobId, task: ctx.job.task }
      ) ?? createFallbackWorkerContextPack({
        jobId: ctx.job.jobId,
        task: ctx.job.task,
        warning: "Setup phase completed without an ORCHESTRA_CONTEXT_PACK block."
      });
      await saveWorkerContextPack(prepared.artifactDir, contextPack);
      emit(`context pack saved with ${contextPack.confidence} confidence`);
    }

    phaseState = updateWorkerTaskPhaseStateForCompletion(phaseState, phase.id, {
      summary: phaseResult.summary,
      changedFiles: phaseResult.changedFiles,
      diffSummaries: phaseResult.diffSummaries,
      latestToolResults: phaseResult.latestToolResults,
      artifactPath: phaseResult.artifactPath ?? prepared.artifactDir
    });
    await saveWorkerTaskPhaseState(prepared.artifactDir, phaseState);
  }

  const finalResult = latestResult ?? buildResumedResultFromState(phaseState, prepared.artifactDir);
  if (!ctx.job.dryRun && finalResult.ok) {
    contextPack = contextPack ?? await loadWorkerContextPack(prepared.artifactDir);
    const boundaryCheck = await runDiffBoundaryCheck({
      changedFiles: finalResult.changedFiles,
      contextPack,
      repoRoot: ctx.job.cwd,
      worktreePath: prepared.worktreePath
    });
    await writeDiffBoundaryCheckArtifact(prepared.artifactDir, boundaryCheck);
    for (const finding of boundaryCheck.findings) {
      const fileSuffix = finding.filePath ? ` (${finding.filePath})` : "";
      emit(`diff boundary ${finding.severity}: ${finding.code}${fileSuffix}`);
    }
    if (!boundaryCheck.ok) {
      return {
        ok: false,
        summary: "Diff boundary check failed.",
        logs,
        filesystemMutated: true,
        artifactPath: finalResult.artifactPath ?? prepared.artifactDir,
        diffSummaries: finalResult.diffSummaries,
        latestToolResults: finalResult.latestToolResults,
        failure: {
          class: "tool-check-failed",
          message: "Diff boundary check failed.",
          step: "worker-diff-boundary",
          retryable: false,
          suggestion: "Review diff-boundary-check.json and keep changes inside the context pack boundary."
        }
      };
    }

    const namingCheck = runNamingGuard({
      changedFiles: finalResult.changedFiles,
      conventions: repoConventions
    });
    await writeNamingGuardArtifact(prepared.artifactDir, namingCheck);
    for (const finding of namingCheck.findings) {
      emit(`naming ${finding.severity}: ${finding.code} (${finding.filePath})`);
    }
    if (!namingCheck.ok) {
      return {
        ok: false,
        summary: "Naming guard failed.",
        logs,
        filesystemMutated: true,
        artifactPath: finalResult.artifactPath ?? prepared.artifactDir,
        diffSummaries: finalResult.diffSummaries,
        latestToolResults: finalResult.latestToolResults,
        failure: {
          class: "tool-check-failed",
          message: "Naming guard failed.",
          step: "worker-naming-guard",
          retryable: false,
          suggestion: "Review naming-check.json and rename generated files to durable domain names."
        }
      };
    }

    const verification = await runWorkerVerification({
      repoRoot: ctx.job.cwd,
      worktreePath: prepared.worktreePath,
      artifactDir: prepared.artifactDir,
      changedFiles: finalResult.changedFiles,
      signal: undefined,
      logger: {
        info: (message) => emit(`verification: ${message}`),
        warn: (message) => emit(`verification warning: ${message}`),
        error: (message) => emit(`verification error: ${message}`),
        step: (message) => emit(`verification step: ${message}`),
        success: (message) => emit(`verification success: ${message}`)
      }
    });

    if (!verification.ok) {
      return {
        ok: false,
        summary: verification.summary,
        logs,
        filesystemMutated: true,
        artifactPath: finalResult.artifactPath ?? prepared.artifactDir,
        diffSummaries: finalResult.diffSummaries,
        latestToolResults: [...(finalResult.latestToolResults ?? []), ...verification.results],
        failure: {
          class: "tool-check-failed",
          message: verification.summary,
          step: "worker-verification",
          retryable: true,
          suggestion: "Fix the failing verification commands and rerun the worker job."
        }
      };
    }
  }

  return {
    ok: finalResult.ok,
    summary: finalResult.summary,
    logs,
    filesystemMutated: !ctx.job.dryRun,
    artifactPath: finalResult.artifactPath ?? prepared.artifactDir,
    diffSummaries: finalResult.diffSummaries,
    latestToolResults: finalResult.latestToolResults,
    failure: finalResult.failure
  };
}

async function persistWorkerPhaseArtifact(
  artifactDir: string,
  phase: WorkerTaskPhase,
  result: WorkerProviderExecutionResultLike
): Promise<void> {
  await fs.mkdir(path.join(artifactDir, "phases"), { recursive: true });
  const phasePath = path.join(artifactDir, "phases", `${phase.id}.json`);
  const body = {
    phase: {
      id: phase.id,
      index: phase.index,
      kind: phase.kind,
      title: phase.title,
      goal: phase.goal
    },
    ok: result.ok,
    summary: result.summary,
    changedFiles: result.changedFiles,
    diffSummaries: result.diffSummaries,
    latestToolResults: result.latestToolResults,
    artifactPath: result.artifactPath,
    failure: result.failure
  };
  await fs.writeFile(phasePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function buildResumedResultFromState(state: WorkerTaskPhaseState, artifactDir: string): WorkerProviderExecutionResultLike {
  const lastCompleted = [...state.phases].reverse().find((phase) => phase.status === "completed");
  if (!lastCompleted) {
    return {
      ok: true,
      summary: "No-op worker execution completed.",
      changedFiles: [],
      artifactPath: artifactDir,
      latestToolResults: [],
      diffSummaries: []
    };
  }

  return {
    ok: true,
    summary: lastCompleted.summary || "Worker phases completed.",
    changedFiles: lastCompleted.changedFiles ?? [],
    artifactPath: lastCompleted.artifactPath ?? artifactDir,
    latestToolResults: lastCompleted.latestToolResults ?? [],
    diffSummaries: lastCompleted.diffSummaries ?? []
  };
}

type WorkerProviderExecutionResultLike = {
  ok: boolean;
  summary: string;
  changedFiles: string[];
  artifactPath?: string | null;
  latestToolResults?: ToolExecutionResult[];
  diffSummaries?: DiffSummary[];
  failure?: FailureMetadata;
};

function parseMutationInstruction(task: string): MutationInstruction | null {
  const trimmed = task.trim();
  const match = /^worker:write-file\s+(.+?)::([\s\S]*)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const relativePath = match[1]?.trim() || "";
  const content = match[2] ?? "";
  if (!relativePath) {
    return null;
  }

  return { relativePath, content };
}
