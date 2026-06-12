import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_PATHS } from "../artifacts/artifact-paths.js";
import type { ArtifactExecutionMode, JobArtifactManifest, JobArtifactSummary } from "../artifacts/artifact-schema.js";
import { LocalArtifactStore } from "../artifacts/local-artifact-store.js";
import { FileAuditLog, resolveAuditLogPath, type AuditEvent, type AuditLogRepository } from "../core/audit-log.js";
import { readManifestFromRoot, updateManifestStatus, writeManifest } from "../artifacts/manifest-writer.js";
import { runCommand } from "../utils/api.js";
import { runSoloJob, type SoloRunInput, type SoloRunResult } from "./solo-runner.js";

export interface SoloJobTargetInput {
  repoRoot: string;
  artifactRootDir?: string;
  target: string;
}

export interface SoloJobListInput {
  repoRoot: string;
  artifactRootDir?: string;
  limit?: number;
}

export interface SoloJobShowResult {
  artifactRoot: string;
  manifest: JobArtifactManifest;
  changedFiles: string[];
  diffStat: string;
  verification: any | null;
}

export interface SoloJobLogsResult {
  artifactRoot: string;
  stdout: string;
  stderr: string;
}

export interface SoloDiffExplainResult {
  artifactRoot: string;
  changedFiles: string[];
  diffStat: string;
  summary: string;
}

export interface SoloUndoResult {
  ok: boolean;
  jobId: string;
  artifactRoot: string;
  summary: string;
}

export interface SoloContinueInput extends SoloJobTargetInput {
  fixVerification?: boolean;
  executionMode?: ArtifactExecutionMode;
  providerId: string;
  providerCommand?: string;
}

export interface SoloContinueResult {
  sourceJobId: string;
  prompt: string;
  run: SoloRunResult;
}

export interface SoloContinueDependencies {
  run?: (input: SoloRunInput) => Promise<SoloRunResult>;
  auditLog?: AuditLogRepository;
}

export interface SoloCommitResult {
  ok: boolean;
  jobId: string;
  artifactRoot: string;
  changedFiles: string[];
  message: string;
  commitSha: string;
  summary: string;
}

export async function listSoloJobs(input: SoloJobListInput): Promise<JobArtifactSummary[]> {
  const store = createStore(input);
  return store.listJobs({ mode: "solo", limit: input.limit });
}

export async function showSoloJob(input: SoloJobTargetInput): Promise<SoloJobShowResult> {
  const resolved = await resolveSoloJob(input);
  const [changedFiles, diffStat, verification] = await Promise.all([
    readJsonFile<string[]>(path.join(resolved.artifactRoot, ARTIFACT_PATHS.changedFiles), []),
    readTextFile(path.join(resolved.artifactRoot, ARTIFACT_PATHS.diffStat)),
    readJsonFile<any | null>(path.join(resolved.artifactRoot, ARTIFACT_PATHS.verification), null)
  ]);

  return {
    artifactRoot: resolved.artifactRoot,
    manifest: resolved.manifest,
    changedFiles,
    diffStat,
    verification
  };
}

export async function readSoloJobLogs(input: SoloJobTargetInput): Promise<SoloJobLogsResult> {
  const resolved = await resolveSoloJob(input);
  const [stdout, stderr] = await Promise.all([
    readTextFile(path.join(resolved.artifactRoot, ARTIFACT_PATHS.providerStdout)),
    readTextFile(path.join(resolved.artifactRoot, ARTIFACT_PATHS.providerStderr))
  ]);
  return {
    artifactRoot: resolved.artifactRoot,
    stdout,
    stderr
  };
}

export async function explainSoloDiff(input: SoloJobTargetInput): Promise<SoloDiffExplainResult> {
  const shown = await showSoloJob(input);
  const summary = summarizeSoloDiff(shown.changedFiles, shown.diffStat);
  return {
    artifactRoot: shown.artifactRoot,
    changedFiles: shown.changedFiles,
    diffStat: shown.diffStat,
    summary
  };
}

export async function undoSoloJob(
  input: SoloJobTargetInput,
  dependencies: { auditLog?: AuditLogRepository } = {}
): Promise<SoloUndoResult> {
  const resolved = await resolveSoloJob(input);
  const diffPath = path.join(resolved.artifactRoot, ARTIFACT_PATHS.diffPatch);
  try {
    await runCommand({
      command: "git",
      args: ["apply", "-R", diffPath],
      cwd: resolved.manifest.repo.root || input.repoRoot,
      timeoutMs: 30000
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reverse patch failed";
    return {
      ok: false,
      jobId: resolved.manifest.jobId,
      artifactRoot: resolved.artifactRoot,
      summary: `Reverse patch failed. Run manually: git apply -R ${diffPath}\n${message}`
    };
  }

  await updateManifestStatus(resolved.artifactRoot, "reverted");
  await appendSoloAuditEvent({
    auditLog: dependencies.auditLog,
    repoRoot: resolved.manifest.repo.root || input.repoRoot,
    action: "solo.undo",
    jobId: resolved.manifest.jobId,
    details: {
      artifactRoot: resolved.artifactRoot,
      summary: `Reverted ${resolved.manifest.jobId}.`
    }
  });
  return {
    ok: true,
    jobId: resolved.manifest.jobId,
    artifactRoot: resolved.artifactRoot,
    summary: `Reverted ${resolved.manifest.jobId}.`
  };
}

export async function continueSoloJob(
  input: SoloContinueInput,
  dependencies: SoloContinueDependencies = {}
): Promise<SoloContinueResult> {
  const resolved = await resolveSoloJobForContinue(input);
  const prompt = await buildContinuePrompt(resolved, Boolean(input.fixVerification));
  const run = await (dependencies.run ?? runSoloJob)({
    task: prompt,
    executionMode: input.executionMode ?? resolved.manifest.executionMode,
    repoRoot: input.repoRoot,
    providerId: input.providerId,
    providerCommand: input.providerCommand,
    artifactRootDir: input.artifactRootDir,
    allowDirtyWorkingTree: true
  });
  await appendSoloAuditEvent({
    auditLog: dependencies.auditLog,
    repoRoot: input.repoRoot,
    action: "solo.continue",
    jobId: run.jobId,
    details: {
      sourceJobId: resolved.manifest.jobId,
      artifactRoot: run.artifactRoot,
      fixVerification: Boolean(input.fixVerification),
      summary: run.summary
    }
  });
  return {
    sourceJobId: resolved.manifest.jobId,
    prompt,
    run
  };
}

export async function buildSoloCommitMessage(input: SoloJobTargetInput): Promise<string> {
  const shown = await showSoloJob(input);
  const taskTitle = firstLine(shown.manifest.task.title ?? shown.manifest.task.prompt);
  const title = truncate(`Apply solo job: ${taskTitle}`, 72);
  const verificationStatus = shown.manifest.summary?.verificationStatus ?? shown.verification?.status ?? "unknown";
  const fileList = shown.changedFiles.length === 0
    ? "- (none)"
    : shown.changedFiles.map((filePath) => `- ${filePath}`).join("\n");
  return [
    title,
    "",
    `Job: ${shown.manifest.jobId}`,
    `Task: ${shown.manifest.task.prompt}`,
    `Verification: ${verificationStatus}`,
    "",
    "Changed files:",
    fileList
  ].join("\n");
}

export async function commitSoloJob(
  input: SoloJobTargetInput,
  dependencies: { auditLog?: AuditLogRepository } = {}
): Promise<SoloCommitResult> {
  const shown = await showSoloJob(input);
  if (shown.changedFiles.length === 0) {
    return {
      ok: false,
      jobId: shown.manifest.jobId,
      artifactRoot: shown.artifactRoot,
      changedFiles: [],
      message: "",
      commitSha: "",
      summary: "No changed files recorded for this job."
    };
  }

  const repoRoot = shown.manifest.repo.root || input.repoRoot;
  const message = await buildSoloCommitMessage(input);
  await runCommand({
    command: "git",
    args: ["add", "--", ...shown.changedFiles],
    cwd: repoRoot,
    timeoutMs: 30000
  });

  try {
    await runCommand({
      command: "git",
      args: ["diff", "--cached", "--quiet", "--", ...shown.changedFiles],
      cwd: repoRoot,
      timeoutMs: 30000
    });
    return {
      ok: false,
      jobId: shown.manifest.jobId,
      artifactRoot: shown.artifactRoot,
      changedFiles: shown.changedFiles,
      message,
      commitSha: "",
      summary: "No staged changes found for this job."
    };
  } catch {
    await runCommand({
      command: "git",
      args: ["commit", "-m", message],
      cwd: repoRoot,
      timeoutMs: 30000
    });
  }

  const commitSha = (await runCommand({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: repoRoot,
    timeoutMs: 30000
  })).stdout.trim();

  const manifest = await readManifestFromRoot(shown.artifactRoot);
  manifest.repo.gitCommitAfter = commitSha;
  await writeManifest(shown.artifactRoot, manifest);
  await appendSoloAuditEvent({
    auditLog: dependencies.auditLog,
    repoRoot,
    action: "solo.commit",
    jobId: shown.manifest.jobId,
    details: {
      artifactRoot: shown.artifactRoot,
      commitSha,
      changedFiles: shown.changedFiles,
      summary: `Committed ${shown.changedFiles.length} file(s) for ${shown.manifest.jobId}.`
    }
  });

  return {
    ok: true,
    jobId: shown.manifest.jobId,
    artifactRoot: shown.artifactRoot,
    changedFiles: shown.changedFiles,
    message,
    commitSha,
    summary: `Committed ${shown.changedFiles.length} file(s) for ${shown.manifest.jobId}.`
  };
}

async function appendSoloAuditEvent(input: {
  repoRoot: string;
  jobId: string;
  action: string;
  details: Record<string, unknown>;
  auditLog?: AuditLogRepository;
}): Promise<AuditEvent | null> {
  const auditLog = input.auditLog ?? new FileAuditLog(resolveAuditLogPath(input.repoRoot));
  try {
    return await auditLog.append({
      action: input.action,
      actor: { id: "ai-system-cli", role: "operator" },
      cwd: input.repoRoot,
      jobId: input.jobId,
      details: input.details
    });
  } catch {
    return null;
  }
}

async function resolveSoloJobForContinue(input: SoloJobTargetInput): Promise<{
  artifactRoot: string;
  manifest: JobArtifactManifest;
}> {
  if (input.target !== "last") {
    return resolveSoloJob(input);
  }

  const jobs = await listSoloJobs({ ...input, limit: 25 });
  const preferred = jobs.find((job) => job.status === "failed" || job.status === "running" || job.status === "created");
  const target = preferred?.jobId ?? jobs[0]?.jobId;
  if (!target) {
    throw new Error("No Solo Mode jobs found.");
  }
  return resolveSoloJob({ ...input, target });
}

async function resolveSoloJob(input: SoloJobTargetInput): Promise<{
  artifactRoot: string;
  manifest: JobArtifactManifest;
}> {
  const artifactRootDir = resolveArtifactRootDir(input);
  if (input.target === "last") {
    const latest = (await listSoloJobs({ ...input, limit: 1 }))[0];
    if (!latest) {
      throw new Error("No Solo Mode jobs found.");
    }
    const artifactRoot = latest.artifactRoot;
    return {
      artifactRoot,
      manifest: await readManifestFromRoot(artifactRoot)
    };
  }

  const artifactRoot = path.join(artifactRootDir, input.target);
  const manifest = await readManifestFromRoot(artifactRoot);
  if (manifest.mode !== "solo") {
    throw new Error(`Job is not a Solo Mode job: ${input.target}`);
  }
  return { artifactRoot, manifest };
}

async function buildContinuePrompt(
  resolved: { artifactRoot: string; manifest: JobArtifactManifest },
  fixVerification: boolean
): Promise<string> {
  const [changedFiles, diffStat, contextPack, verification] = await Promise.all([
    readJsonFile<string[]>(path.join(resolved.artifactRoot, ARTIFACT_PATHS.changedFiles), []),
    readTextFile(path.join(resolved.artifactRoot, ARTIFACT_PATHS.diffStat)),
    readTextFile(path.join(resolved.artifactRoot, ARTIFACT_PATHS.contextPackMarkdown)),
    readTextFile(path.join(resolved.artifactRoot, ARTIFACT_PATHS.verification))
  ]);
  const goal = fixVerification
    ? "Fix verification failures while preserving the current diff intent."
    : "Continue the implementation from the current repository state.";
  return [
    `Continue Orchestra Solo job ${resolved.manifest.jobId}.`,
    "",
    goal,
    "",
    "Original task:",
    resolved.manifest.task.prompt,
    "",
    `Previous status: ${resolved.manifest.status}`,
    `Previous execution mode: ${resolved.manifest.executionMode}`,
    "",
    "Changed files from previous job:",
    changedFiles.length === 0 ? "- (none)" : changedFiles.map((filePath) => `- ${filePath}`).join("\n"),
    "",
    "Previous diff stat:",
    diffStat.trim() || "(none)",
    "",
    "Previous verification result:",
    verification.trim() || "(none)",
    "",
    "Previous context pack:",
    contextPack.trim() || "(none)"
  ].join("\n");
}

function createStore(input: Pick<SoloJobListInput, "repoRoot" | "artifactRootDir">): LocalArtifactStore {
  return new LocalArtifactStore(resolveArtifactRootDir(input));
}

function resolveArtifactRootDir(input: Pick<SoloJobListInput, "repoRoot" | "artifactRootDir">): string {
  return input.artifactRootDir ?? path.join(input.repoRoot, ".orchestra", "jobs");
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0]?.trim() || "Solo job changes";
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function summarizeSoloDiff(changedFiles: string[], diffStat: string): string {
  if (changedFiles.length === 0) {
    return "No changed files recorded.";
  }

  const statLines = diffStat
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- ${line}`);

  const header = `${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} changed`;
  const changedFilesSummary = changedFiles.map((filePath) => `- ${filePath}`);

  return [
    header,
    ...(statLines.length > 0 ? statLines : changedFilesSummary)
  ].join("\n");
}
