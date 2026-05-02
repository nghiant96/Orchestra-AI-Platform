import path from "node:path";
import { runCommandWithRetry } from "../utils/api.js";
import { truncate } from "../utils/string.js";
import { resolveSandboxImage, resolveToolSandbox } from "./tool-sandbox.js";
import type { CliCommandError, GeneratedFile, ReviewIssue, ToolExecutionName, ToolExecutionResult } from "../types.js";
import type { ResolvedToolCommand } from "./tool-scoping.js";

const DEFAULT_TOOL_TIMEOUT_MS: Record<string, number> = {
  lint: 120000,
  typecheck: 120000,
  build: 180000,
  test: 180000
};

export function runJsonValidation(changedFiles: GeneratedFile[]): { result: ToolExecutionResult; issues: ReviewIssue[] } {
  const issues: ReviewIssue[] = [];

  for (const file of changedFiles) {
    if (!file?.path?.endsWith(".json")) continue;

    try {
      JSON.parse(file.content);
    } catch (error) {
      const normalized = error as Error;
      issues.push({
        severity: "high",
        category: "tool:json-validation",
        path: file.path,
        description: `Invalid JSON syntax: ${normalized.message}`,
        suggestedFix: "Fix the JSON syntax before writing the file."
      });
    }
  }

  return {
    result: {
      name: "json-validation",
      kind: "validation",
      ok: issues.length === 0,
      skipped: false,
      issueCount: issues.length,
      durationMs: 0,
      summary: issues.length === 0 ? "JSON validation passed." : `JSON validation found ${issues.length} issue(s).`
    },
    issues
  };
}

export function buildToolInvocation(
  resolved: ResolvedToolCommand,
  repoRoot: string
): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  if (resolved.sandboxMode !== "docker") {
    return {
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: resolved.env
    };
  }

  const dockerEnvArgs: string[] = [];
  for (const [key, value] of Object.entries(resolved.env)) {
    if (value !== undefined) dockerEnvArgs.push("--env", key);
  }

  const relativeExecutionDir = normalizePath(path.relative(repoRoot, resolved.cwd));
  const containerWorkingDirectory = !relativeExecutionDir || relativeExecutionDir === "." ? "/workspace" : `/workspace/${relativeExecutionDir}`;

  return {
    command: "docker",
    args: [
      "run",
      "--rm",
      ...dockerEnvArgs,
      "-v",
      `${path.resolve(repoRoot)}:/workspace`,
      "-w",
      containerWorkingDirectory,
      resolved.image || "ai-coding-system:local",
      resolved.command,
      ...resolved.args
    ],
    cwd: repoRoot,
    env: {
      ...process.env,
      ...resolved.env
    }
  };
}

export function applyResolvedSandboxImage(
  resolved: ResolvedToolCommand,
  sandbox: ReturnType<typeof resolveToolSandbox>,
  repoRoot: string,
  projectType: string
): ResolvedToolCommand {
  if (resolved.sandboxMode !== "docker") return resolved;

  const sandboxImage = resolveSandboxImage(sandbox, {
    repoRoot,
    projectType
  });
  return {
    ...resolved,
    image: resolved.image || sandboxImage.image,
    imageProfile: sandboxImage.imageProfile,
    autoBuild: sandbox.autoBuild,
    dockerfile: sandboxImage.dockerfile,
    buildHint: sandboxImage.buildHint
  };
}

export async function preflightDockerSandbox(
  resolved: ResolvedToolCommand,
  repoRoot: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; summary: string }> {
  if (resolved.sandboxMode !== "docker") return { ok: true, summary: "" };

  const image = resolved.image || "ai-coding-system:local";
  const dockerfile = resolved.dockerfile || path.join(repoRoot, "Dockerfile");
  const buildHint = resolved.buildHint || `docker build -t ${image} -f ${dockerfile} ${path.resolve(repoRoot)}`;

  try {
    await runCommandWithRetry({
      command: "docker",
      args: ["--version"],
      cwd: repoRoot,
      timeoutMs: 10000,
      retries: 0,
      baseDelayMs: 0,
      label: "docker --version",
      signal
    });
  } catch {
    return {
      ok: false,
      summary: `Skipped ${resolved.name}: Docker is unavailable. Install Docker or switch tools.sandbox.mode to inherit/clean-env.`
    };
  }

  try {
    await runCommandWithRetry({
      command: "docker",
      args: ["image", "inspect", image],
      cwd: repoRoot,
      timeoutMs: 10000,
      retries: 0,
      baseDelayMs: 0,
      label: `docker image inspect ${image}`,
      signal
    });
    return { ok: true, summary: "" };
  } catch {
    if (!resolved.autoBuild) {
      return {
        ok: false,
        summary: `Skipped ${resolved.name}: Docker image ${image} is missing. Build it with: ${buildHint}`
      };
    }
  }

  await runCommandWithRetry({
    command: "docker",
    args: ["build", "-t", image, "-f", dockerfile, path.resolve(repoRoot)],
    cwd: repoRoot,
    timeoutMs: DEFAULT_TOOL_TIMEOUT_MS.build,
    retries: 0,
    baseDelayMs: 0,
    label: `docker build ${image}`,
    signal
  });
  return { ok: true, summary: "" };
}

export function buildToolIssue(toolName: ToolExecutionName, error: unknown): ReviewIssue {
  return {
    severity: "medium",
    category: `tool:${toolName}`,
    path: "",
    description: `${toolName} failed:\n${formatCommandOutput(error)}`,
    suggestedFix: `Fix the reported ${toolName} errors before accepting the generated files.`
  };
}

export function looksLikeMissingExecutable(error: unknown): boolean {
  const message = `${(error as Error | undefined)?.message ?? ""}`.toLowerCase();
  return message.includes("failed to start") || message.includes("enoent");
}

function formatCommandOutput(error: unknown): string {
  const normalized = error as CliCommandError | undefined;
  const output = [normalized?.stderr, normalized?.stdout, normalized?.message].filter(Boolean).join("\n").trim();

  return truncate(output || "Unknown tool execution failure.", 1200);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
