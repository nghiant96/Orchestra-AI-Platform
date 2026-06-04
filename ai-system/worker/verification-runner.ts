import fs from "node:fs/promises";
import path from "node:path";
import { loadRules } from "../core/orchestrator-runtime.js";
import { runToolChecks } from "../core/tool-executor.js";
import type { GeneratedFile, ToolExecutionResult, ToolExecutionSummary } from "../types.js";
import { redactWorkerLogLine } from "./worker-safety.js";

export interface WorkerVerificationInput {
  repoRoot: string;
  worktreePath: string;
  artifactDir: string;
  changedFiles: string[];
  signal?: AbortSignal;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    step(message: string): void;
    success(message: string): void;
  };
}

export interface WorkerVerificationResult {
  ok: boolean;
  summary: string;
  summaryData: ToolExecutionSummary;
  results: ToolExecutionResult[];
}

export async function runWorkerVerification(input: WorkerVerificationInput): Promise<WorkerVerificationResult> {
  const { rules } = await loadRules(input.repoRoot);
  const changedFiles = await readChangedFiles(input.worktreePath, input.changedFiles);
  const summary = await runToolChecks({
    repoRoot: input.worktreePath,
    changedFiles,
    rules,
    logger: input.logger,
    signal: input.signal
  });

  const ok = summary.results.filter((result) => !result.skipped).every((result) => result.ok) && summary.issues.every((issue) => issue.severity !== "high");
  const resultSummary = ok
    ? `${summary.results.filter((result) => result.ok).length}/${summary.results.length} verification command(s) passed.`
    : `${summary.results.filter((result) => result.ok).length}/${summary.results.length} verification command(s) passed.`;

  await writeVerificationArtifacts(input.artifactDir, summary);

  return {
    ok,
    summary: resultSummary,
    summaryData: summary,
    results: summary.results
  };
}

async function readChangedFiles(worktreePath: string, changedFiles: string[]): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  for (const filePath of changedFiles) {
    if (!filePath || filePath.includes("\0")) {
      continue;
    }
    const absolutePath = path.join(worktreePath, filePath);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      files.push({ path: filePath, content });
    } catch {
      continue;
    }
  }
  return files;
}

async function writeVerificationArtifacts(artifactDir: string, summary: ToolExecutionSummary): Promise<void> {
  const checksDir = path.join(artifactDir, "checks");
  await fs.mkdir(checksDir, { recursive: true });

  const verificationJson = {
    status: summary.results.filter((result) => !result.skipped).every((result) => result.ok) && summary.issues.every((issue) => issue.severity !== "high")
      ? "passed"
      : "failed",
    generatedAt: new Date().toISOString(),
    results: summary.results,
    issues: summary.issues
  };

  await Promise.all([
    fs.writeFile(path.join(artifactDir, "verification.json"), `${JSON.stringify(verificationJson, null, 2)}\n`, "utf8"),
    ...summary.results.map(async (result, index) => {
      const safeName = sanitizeFileName(result.name || `check-${index + 1}`);
      const body = [
        `name: ${result.name}`,
        `ok: ${result.ok}`,
        `skipped: ${result.skipped}`,
        `checkStatus: ${result.checkStatus ?? "unknown"}`,
        `summary: ${result.summary}`,
        result.command ? `command: ${result.command}` : null,
        result.args ? `args: ${JSON.stringify(result.args)}` : null,
        result.scope ? `scope: ${result.scope}` : null,
        result.stdout ? `stdout:\n${redactWorkerLogLine(result.stdout)}` : null,
        result.stderr ? `stderr:\n${redactWorkerLogLine(result.stderr)}` : null
      ].filter((line): line is string => Boolean(line)).join("\n\n");
      await fs.writeFile(path.join(checksDir, `${safeName}.log`), `${body}\n`, "utf8");
    })
  ]);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "check";
}
