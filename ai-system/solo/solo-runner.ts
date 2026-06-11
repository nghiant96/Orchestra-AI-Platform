import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_PATHS } from "../artifacts/artifact-paths.js";
import { captureGitArtifacts } from "../artifacts/git-artifact-capture.js";
import type {
  ArtifactExecutionMode,
  ArtifactGuardStatus,
  ArtifactVerificationStatus
} from "../artifacts/artifact-schema.js";
import { buildContext } from "../context/context-builder.js";
import { LocalArtifactStore } from "../artifacts/local-artifact-store.js";
import {
  updateManifestArtifactRefs,
  updateManifestStatus,
  updateManifestSummary
} from "../artifacts/manifest-writer.js";
import { runCommand } from "../utils/api.js";
import {
  createFallbackWorkerContextPack,
  saveWorkerContextPack
} from "../worker/context-pack.js";
import { extractContextPackFromProviderResult } from "../worker/context-pack-parser.js";
import { runDiffBoundaryCheck, writeDiffBoundaryCheckArtifact } from "../worker/diff-boundary-checker.js";
import { runNamingGuard, writeNamingGuardArtifact } from "../worker/naming-guard.js";
import { buildSetupPromptWithPreContext } from "../worker/contextual-phase-prompt.js";
import { buildProviderEnv } from "../worker/provider-env.js";
import { resolveWorkerProvider } from "../worker/providers/index.js";
import type { WorkerProviderAdapter } from "../worker/providers/provider-adapter.js";
import { scanRepoConventions, writeRepoConventionScanArtifact } from "../worker/repo-convention-scanner.js";
import { runWorkerVerification } from "../worker/verification-runner.js";

export interface SoloRunInput {
  task: string;
  executionMode: ArtifactExecutionMode;
  repoRoot: string;
  providerId: string;
  providerCommand?: string;
  artifactRootDir?: string;
  allowDirtyWorkingTree?: boolean;
}

export interface SoloRunResult {
  ok: boolean;
  jobId: string;
  artifactRoot: string;
  summary: string;
  changedFiles: string[];
  guardStatus: ArtifactGuardStatus;
  verificationStatus: ArtifactVerificationStatus;
}

export interface SoloRunnerDependencies {
  provider?: WorkerProviderAdapter;
  createJobId?: () => string;
}

export async function runSoloJob(
  input: SoloRunInput,
  dependencies: SoloRunnerDependencies = {}
): Promise<SoloRunResult> {
  const repoRoot = await fs.realpath(input.repoRoot);
  await assertGitRepository(repoRoot);
  if (!input.allowDirtyWorkingTree) {
    await assertCleanWorkingTree(repoRoot);
  }

  const jobId = dependencies.createJobId?.() ?? createSoloJobId();
  const store = new LocalArtifactStore(input.artifactRootDir ?? path.join(repoRoot, ".orchestra", "jobs"));
  const branch = await readGitValue(repoRoot, ["branch", "--show-current"]);
  const jobRef = await store.createJob({
    jobId,
    mode: "solo",
    executionMode: input.executionMode,
    task: { prompt: input.task },
    repo: {
      root: repoRoot,
      branch: branch || undefined,
      worktreePath: repoRoot
    },
    provider: {
      id: input.providerId,
      command: input.providerCommand
    }
  });
  const artifactRoot = jobRef.artifactRoot;
  await updateManifestArtifactRefs(artifactRoot, { task: ARTIFACT_PATHS.task });
  await updateManifestStatus(artifactRoot, "running");

  const conventions = await scanRepoConventions(repoRoot);
  await writeRepoConventionScanArtifact(artifactRoot, conventions);
  await updateManifestArtifactRefs(artifactRoot, {
    repoConventions: ARTIFACT_PATHS.repoConventions
  });

  const provider = dependencies.provider ?? resolveWorkerProvider(input.providerId, {
    codexCommand: input.providerCommand
  });
  let preContextPack: Awaited<ReturnType<typeof buildContext>>["preContextPack"] | null;
  try {
    const builtContext = await buildContext({
      jobId,
      task: input.task,
      repoRoot,
      artifactDir: artifactRoot
    }, {
      repoConventions: conventions
    });
    preContextPack = builtContext.preContextPack;
  } catch (error) {
    preContextPack = createFallbackWorkerContextPack({
      jobId,
      task: input.task,
      warning: error instanceof Error ? error.message : "Failed to build pre-context."
    });
    await saveWorkerContextPack(artifactRoot, preContextPack);
  }
  await updateManifestArtifactRefs(artifactRoot, {
    preContextPack: ARTIFACT_PATHS.preContextPack,
    preContextPackMarkdown: ARTIFACT_PATHS.preContextPackMarkdown
  });
  const providerInput = {
    jobId,
    task: buildSoloProviderPrompt(input.task, input.executionMode, preContextPack),
    cwd: repoRoot,
    worktreePath: repoRoot,
    workspaceRoot: repoRoot,
    artifactDir: artifactRoot,
    preparedWorktree: {
      workspaceRoot: repoRoot,
      sourceRepoPath: repoRoot,
      worktreePath: repoRoot,
      artifactDir: artifactRoot
    },
    dryRun: false,
    workflowMode: "solo",
    workflowProfile: input.executionMode,
    approvalPolicy: null,
    env: buildProviderEnv()
  };

  if (!(await provider.isAvailable(providerInput))) {
    return finishSoloJob({
      artifactRoot,
      jobId,
      ok: false,
      summary: `Solo provider is not available: ${provider.id}`,
      changedFiles: [],
      guardStatus: "skipped",
      verificationStatus: "skipped"
    });
  }

  const providerResult = await provider.execute(providerInput);
  await fs.mkdir(path.join(artifactRoot, "provider"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(artifactRoot, ARTIFACT_PATHS.providerStdout), providerResult.stdout, "utf8"),
    fs.writeFile(path.join(artifactRoot, ARTIFACT_PATHS.providerStderr), providerResult.stderr, "utf8")
  ]);
  await updateManifestArtifactRefs(artifactRoot, {
    providerStdout: ARTIFACT_PATHS.providerStdout,
    providerStderr: ARTIFACT_PATHS.providerStderr
  });

  const captured = await captureGitArtifacts({ repoRoot, artifactRoot });
  await updateManifestArtifactRefs(artifactRoot, {
    diffPatch: ARTIFACT_PATHS.diffPatch,
    diffStat: ARTIFACT_PATHS.diffStat,
    changedFiles: ARTIFACT_PATHS.changedFiles
  });

  const contextPack = extractContextPackFromProviderResult(
    [providerResult.stdout, providerResult.stderr, providerResult.summary].join("\n"),
    { jobId, task: input.task }
  ) ?? createFallbackWorkerContextPack({
    jobId,
    task: input.task,
    warning: "Solo provider completed without an ORCHESTRA_CONTEXT_PACK block."
  });
  await saveWorkerContextPack(artifactRoot, contextPack);
  await updateManifestArtifactRefs(artifactRoot, {
    contextPack: ARTIFACT_PATHS.contextPack,
    contextPackMarkdown: ARTIFACT_PATHS.contextPackMarkdown
  });

  if (!providerResult.ok) {
    return finishSoloJob({
      artifactRoot,
      jobId,
      ok: false,
      summary: providerResult.summary,
      changedFiles: captured.changedFiles,
      guardStatus: "skipped",
      verificationStatus: "skipped"
    });
  }

  if (input.executionMode === "safe" && contextPack.confidence === "low") {
    return finishSoloJob({
      artifactRoot,
      jobId,
      ok: false,
      summary: "Safe mode requires a valid Context Pack from the provider.",
      changedFiles: captured.changedFiles,
      guardStatus: "failed",
      verificationStatus: "skipped"
    });
  }

  const strict = input.executionMode === "safe";
  const boundary = await runDiffBoundaryCheck({
    changedFiles: captured.changedFiles,
    contextPack,
    repoRoot,
    worktreePath: repoRoot,
    mode: strict ? "strict" : "warn",
    newFilePolicy: strict ? "strict" : "warn"
  });
  await writeDiffBoundaryCheckArtifact(artifactRoot, boundary);

  const naming = runNamingGuard({
    changedFiles: captured.changedFiles,
    conventions,
    mode: strict ? "strict" : "warn"
  });
  await writeNamingGuardArtifact(artifactRoot, naming);
  await updateManifestArtifactRefs(artifactRoot, {
    diffBoundaryCheck: ARTIFACT_PATHS.diffBoundaryCheck,
    namingCheck: ARTIFACT_PATHS.namingCheck
  });

  const guardStatus: ArtifactGuardStatus = !boundary.ok || !naming.ok
    ? "failed"
    : boundary.findings.length > 0 || naming.findings.length > 0
      ? "warning"
      : "passed";
  if (!boundary.ok || !naming.ok) {
    return finishSoloJob({
      artifactRoot,
      jobId,
      ok: false,
      summary: !boundary.ok ? "Diff boundary check failed." : "Naming guard failed.",
      changedFiles: captured.changedFiles,
      guardStatus,
      verificationStatus: "skipped"
    });
  }

  const verification = await runWorkerVerification({
    repoRoot,
    worktreePath: repoRoot,
    artifactDir: artifactRoot,
    changedFiles: captured.changedFiles
  });
  await updateManifestArtifactRefs(artifactRoot, {
    verification: ARTIFACT_PATHS.verification
  });

  return finishSoloJob({
    artifactRoot,
    jobId,
    ok: verification.ok,
    summary: verification.ok
      ? `Solo job completed with ${captured.changedFiles.length} changed file(s).`
      : verification.summary,
    changedFiles: captured.changedFiles,
    guardStatus,
    verificationStatus: verification.ok ? "passed" : "failed"
  });
}

async function finishSoloJob(result: SoloRunResult): Promise<SoloRunResult> {
  await updateManifestStatus(result.artifactRoot, result.ok ? "completed" : "failed");
  await updateManifestSummary(result.artifactRoot, {
    changedFileCount: result.changedFiles.length,
    guardStatus: result.guardStatus,
    verificationStatus: result.verificationStatus
  });
  return result;
}

async function assertGitRepository(repoRoot: string): Promise<void> {
  await runCommand({
    command: "git",
    args: ["rev-parse", "--is-inside-work-tree"],
    cwd: repoRoot,
    timeoutMs: 10000
  });
}

async function assertCleanWorkingTree(repoRoot: string): Promise<void> {
  const status = await readGitValue(repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude).orchestra/**"
  ]);
  if (status.trim()) {
    throw new Error("Solo Mode requires a clean working tree so job artifacts and undo remain isolated.");
  }
}

async function readGitValue(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await runCommand({ command: "git", args, cwd, timeoutMs: 30000 });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

function buildSoloProviderPrompt(
  task: string,
  executionMode: ArtifactExecutionMode,
  preContextPack: Awaited<ReturnType<typeof buildContext>>["preContextPack"] | null
): string {
  const basePrompt = [
    "You are executing an Orchestra Solo Mode coding job directly in the current repository.",
    `Execution mode: ${executionMode}`,
    "Keep the change focused and do not commit it.",
    "Include an ORCHESTRA_CONTEXT_PACK JSON block in your final output describing relevant files, allowedDiffBoundary, doNotTouch paths, conventions, plan, verification commands, assumptions, warnings, and confidence.",
    "",
    task
  ].join("\n");

  return buildSetupPromptWithPreContext({
    phasePrompt: basePrompt,
    preContextPack
  });
}

function createSoloJobId(): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `job-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}
