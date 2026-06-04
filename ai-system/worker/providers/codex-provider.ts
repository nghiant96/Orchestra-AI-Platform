import fs from "node:fs/promises";
import path from "node:path";
import { checkCommand } from "../../security/command-policy.js";
import type { DiffSummary, ToolExecutionResult } from "../../types.js";
import { runCommand } from "../../utils/api.js";
import { redactSecrets } from "../../security/secret-redaction.js";
import { ensurePathWithinRoot } from "../worker-safety.js";
import { WorkerProcessSupervisor } from "../worker-process-supervisor.js";
import { prepareWorkerWorktree } from "../worker-worktree.js";
import type { WorkerProviderAdapter, WorkerProviderExecutionInput, WorkerProviderExecutionResult } from "./provider-adapter.js";

export class CodexProvider implements WorkerProviderAdapter {
  readonly id = "codex" as const;
  private readonly supervisor = new WorkerProcessSupervisor();

  constructor(private readonly command = process.env.ORCHESTRA_CODEX_COMMAND || "codex") {}

  async isAvailable(input: WorkerProviderExecutionInput): Promise<boolean> {
    const policy = checkCommand(`${this.command} --version`);
    if (!policy.allowed) return false;
    try {
      await this.supervisor.run({
        command: this.command,
        args: ["--version"],
        cwd: input.worktreePath,
        env: input.env,
        timeoutMs: 5000,
        signal: input.signal
      });
      return true;
    } catch {
      return false;
    }
  }

  async execute(input: WorkerProviderExecutionInput): Promise<WorkerProviderExecutionResult> {
    try {
      ensurePathWithinRoot(input.workspaceRoot, input.worktreePath);
    } catch (error) {
      return failureResult(input, "Provider worktree is outside workspace root", error);
    }

    const prepared = input.preparedWorktree ?? await prepareWorkerWorktree({
      jobId: input.jobId,
      cwd: input.cwd,
      workspaceRoots: [input.workspaceRoot]
    });
    if (prepared.worktreePath !== input.worktreePath) {
      return failureResult(input, "Provider worktree preparation did not resolve the expected path");
    }

    const prompt = buildPrompt(input);
    const commandLine = `${this.command} exec <prompt>`;
    const policy = checkCommand(commandLine);
    if (!policy.allowed || policy.requiresApproval) {
      return failureResult(input, policy.reason || "Provider command is not allowed");
    }

    const startedAt = Date.now();
    let stdout: string;
    let stderr: string;
    let ok = true;
    let failureMessage = "";

    try {
      const result = await this.supervisor.run({
        command: this.command,
        args: ["exec", prompt],
        cwd: input.worktreePath,
        env: input.env,
        timeoutMs: Number(process.env.ORCHESTRA_CODEX_TIMEOUT_MS || 10 * 60 * 1000),
        signal: input.signal
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error: any) {
      ok = false;
      stdout = typeof error?.stdout === "string" ? error.stdout : "";
      stderr = typeof error?.stderr === "string" ? error.stderr : "";
      failureMessage = error instanceof Error ? error.message : "Codex provider failed";
    }

    const artifact = await captureArtifacts(input, stdout, stderr);
    const durationMs = Date.now() - startedAt;
    const latestToolResults: ToolExecutionResult[] = [
      {
        name: "worker-provider:codex",
        kind: "command",
        ok,
        skipped: false,
        issueCount: ok ? 0 : 1,
        durationMs,
        summary: ok ? "Codex provider completed." : failureMessage,
        command: this.command,
        args: ["exec", "<prompt>"],
        workingDirectory: input.worktreePath,
        stdout: scrub(stdout),
        stderr: scrub(stderr)
      },
      {
        name: "worker-provider:git-diff",
        kind: "command",
        ok: true,
        skipped: false,
        issueCount: 0,
        durationMs: 0,
        summary: `${artifact.changedFiles.length} changed file(s) captured.`,
        command: "git",
        args: ["diff", "--binary"],
        workingDirectory: input.worktreePath,
        stdout: artifact.diffText
      }
    ];

    return {
      ok,
      summary: ok
        ? `Codex provider completed with ${artifact.changedFiles.length} changed file(s).`
        : `Codex provider failed: ${failureMessage}`,
      stdout: scrub(stdout),
      stderr: scrub(stderr),
      changedFiles: artifact.changedFiles,
      diffText: artifact.diffText,
      artifactPath: input.artifactDir,
      workerLogs: [
        `provider codex ${ok ? "completed" : "failed"}`,
        `artifact path: ${input.artifactDir}`,
        `changed files: ${artifact.changedFiles.join(", ") || "none"}`
      ],
      diffSummaries: artifact.diffSummaries,
      latestToolResults,
      failure: ok
        ? undefined
        : {
            class: "provider-error",
            message: failureMessage || "Codex provider failed",
            step: "worker-provider:codex",
            retryable: true,
            suggestion: "Check Codex CLI availability, authentication, and provider logs."
          }
    };
  }
}

async function captureArtifacts(input: WorkerProviderExecutionInput, stdout: string, stderr: string): Promise<{
  changedFiles: string[];
  diffText: string;
  diffSummaries: DiffSummary[];
}> {
  await fs.mkdir(input.artifactDir, { recursive: true });

  const status = await safeGit(input.worktreePath, ["status", "--porcelain"]);
  const changedFiles = parseChangedFiles(status);
  const untrackedFiles = parseUntrackedFiles(status);
  if (untrackedFiles.length > 0) {
    await safeGit(input.worktreePath, ["add", "-N", "--", ...untrackedFiles]);
  }
  const diffText = await safeGit(input.worktreePath, ["diff", "--binary"]);
  const diffStat = await safeGit(input.worktreePath, ["diff", "--stat"]);
  const numStat = await safeGit(input.worktreePath, ["diff", "--numstat"]);
  const diffSummaries = parseNumStat(numStat);
  const shouldUploadRaw = process.env.ORCHESTRA_UPLOAD_RAW_TRANSCRIPTS === "true";

  await Promise.all([
    fs.writeFile(path.join(input.artifactDir, "diff.patch"), diffText, "utf8"),
    fs.writeFile(path.join(input.artifactDir, "diff-stat.txt"), diffStat, "utf8"),
    fs.writeFile(path.join(input.artifactDir, "changed-files.json"), `${JSON.stringify(changedFiles, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(input.artifactDir, "provider-stdout.log"), shouldUploadRaw ? stdout : scrub(stdout), "utf8"),
    fs.writeFile(path.join(input.artifactDir, "provider-stderr.log"), shouldUploadRaw ? stderr : scrub(stderr), "utf8")
  ]);

  return { changedFiles, diffText, diffSummaries };
}

async function safeGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await runCommand({
      command: "git",
      args,
      cwd,
      timeoutMs: 30000
    });
    return result.stdout;
  } catch {
    return "";
  }
}

function buildPrompt(input: WorkerProviderExecutionInput): string {
  return [
    "You are executing an Orchestra worker job.",
    `Job ID: ${input.jobId}`,
    `Mode: ${input.dryRun ? "dry-run" : "write"}`,
    input.workflowMode ? `Workflow mode: ${input.workflowMode}` : "",
    input.workflowProfile ? `Workflow profile: ${input.workflowProfile}` : "",
    "",
    input.task
  ].filter(Boolean).join("\n");
}

function parseChangedFiles(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((line) => line.includes(" -> ") ? line.split(" -> ").pop() || line : line);
}

function parseUntrackedFiles(status: string): string[] {
  return status
    .split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function parseNumStat(numStat: string): DiffSummary[] {
  return numStat.split(/\r?\n/).filter(Boolean).map((line) => {
    const [addedRaw, removedRaw, filePath = ""] = line.split(/\t/);
    const addedLines = Number(addedRaw);
    const removedLines = Number(removedRaw);
    const safeAdded = Number.isFinite(addedLines) ? addedLines : 0;
    const safeRemoved = Number.isFinite(removedLines) ? removedLines : 0;
    return {
      path: filePath,
      beforeLineCount: 0,
      afterLineCount: 0,
      addedLines: safeAdded,
      removedLines: safeRemoved,
      changedLineEstimate: safeAdded + safeRemoved
    };
  });
}

function scrub(value: string): string {
  return redactSecrets(value);
}

function failureResult(input: WorkerProviderExecutionInput, message: string, error?: unknown): WorkerProviderExecutionResult {
  const detail = error instanceof Error ? error.message : undefined;
  return {
    ok: false,
    summary: message,
    stdout: "",
    stderr: detail || "",
    changedFiles: [],
    artifactPath: input.artifactDir,
    workerLogs: [`provider codex failed: ${message}`],
    failure: {
      class: "provider-error",
      message,
      detail,
      step: "worker-provider:codex",
      retryable: false,
      suggestion: "Fix worker provider configuration before retrying."
    }
  };
}
