import fs from "node:fs/promises";
import path from "node:path";
import { runCommandWithRetry } from "../utils/api.js";
import { truncate } from "../utils/string.js";
import { detectToolAdapterContexts } from "./tool-adapters.js";
import { buildToolInvocation, applyResolvedSandboxImage, buildToolIssue, classifyToolFailure, looksLikeMissingExecutable, preflightDockerSandbox, runJsonValidation } from "./tool-runner.js";
import { resolveFullScopeFallback, resolveToolCommand } from "./tool-scoping.js";
import { resolveToolSandbox } from "./tool-sandbox.js";
import type {
  CliCommandError,
  GeneratedFile,
  Logger,
  ReviewIssue,
  RulesConfig,
  ToolCheckStatus,
  ToolCheckFailureClass,
  ToolConfigurationSummary,
  ToolExecutionName,
  ToolExecutionResult,
  ToolExecutionSummary
} from "../types.js";

export async function runToolChecks({
  repoRoot,
  changedFiles,
  rules,
  logger,
  signal
}: {
  repoRoot: string;
  changedFiles: GeneratedFile[];
  rules: RulesConfig;
  logger?: Logger;
  signal?: AbortSignal;
}): Promise<ToolExecutionSummary> {
  if (signal?.aborted) throw new Error("AbortError");
  const issues: ReviewIssue[] = [];
  const results: ToolExecutionResult[] = [];
  const tools = rules.tools ?? {};

  if (tools.json_validation !== false) {
    const validation = runJsonValidation(changedFiles);
    issues.push(...validation.issues);
    results.push(validation.result);
  }

  if (tools.enabled === false) return { results, issues };

  const packageJson = await readPackageJson(path.join(repoRoot, "package.json"));
  const packageScripts = normalizeScripts(packageJson);
  const packageManager = await detectPackageManager(repoRoot);
  const changedPaths = changedFiles.map((file) => file.path).filter(Boolean);
  const sandbox = resolveToolSandbox(tools.sandbox);
  const projectType = String(tools.project_type ?? "auto");
  const adapterContexts = await detectToolAdapterContexts(repoRoot, changedPaths, tools);
  const toolNames = Object.keys(tools.commands || {}) as ToolExecutionName[];

  for (const standardTool of ["lint", "typecheck", "build", "test"] as ToolExecutionName[]) {
    if (!toolNames.includes(standardTool)) toolNames.push(standardTool);
  }

  for (const toolName of toolNames) {
    let resolved = await resolveToolCommand({
      repoRoot,
      toolName,
      toolConfig: tools.commands?.[toolName],
      packageScripts,
      packageManager,
      changedPaths,
      adapterContexts,
      sandbox,
      projectType
    });

    if (!resolved) {
      results.push({
        name: toolName,
        kind: "command",
        ok: false,
        skipped: true,
        issueCount: 0,
        durationMs: 0,
        summary: `Skipped ${toolName}: no configured or detected command.`,
        checkStatus: "unavailable" as ToolCheckStatus,
        failureClass: null
      });
      continue;
    }

    resolved = applyResolvedSandboxImage(resolved, sandbox, repoRoot, resolved.imageProfile ?? projectType);
    logger?.step(`Running tool check: ${resolved.display}${resolved.sandboxMode === "docker" ? " [sandbox=docker]" : ""}`);
    const startedAt = Date.now();

    try {
      const preflight = await preflightDockerSandbox(resolved, repoRoot, signal);
      if (!preflight.ok) {
        logger?.warn(preflight.summary);
        results.push({
          name: toolName,
          kind: "command",
          ok: false,
          skipped: true,
          issueCount: 0,
          durationMs: Date.now() - startedAt,
          summary: preflight.summary,
          command: resolved.command,
          args: resolved.args,
          scope: resolved.scope,
          sandboxMode: resolved.sandboxMode,
          sandboxImage: resolved.image,
          sandboxImageProfile: resolved.imageProfile,
          workingDirectory: resolved.workingDirectory,
          checkStatus: "unavailable" as ToolCheckStatus,
          failureClass: null
        });
        continue;
      }

      const invocation = buildToolInvocation(resolved, repoRoot);
      const commandResult = await runCommandWithRetry({
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        env: invocation.env,
        timeoutMs: resolved.timeoutMs,
        retries: resolved.retries,
        baseDelayMs: resolved.baseDelayMs,
        label: resolved.display,
        signal
      });

      results.push({
        name: toolName,
        kind: "command",
        ok: true,
        skipped: false,
        issueCount: 0,
        durationMs: Date.now() - startedAt,
        summary: `${toolName} passed.`,
        command: resolved.command,
        args: resolved.args,
        scope: resolved.scope,
        sandboxMode: resolved.sandboxMode,
        sandboxImage: resolved.image,
        sandboxImageProfile: resolved.imageProfile,
        workingDirectory: resolved.workingDirectory,
        exitCode: commandResult.code,
        stdout: truncate(commandResult.stdout.trim(), 1200),
        stderr: truncate(commandResult.stderr.trim(), 1200),
        checkStatus: "passed" as ToolCheckStatus,
        failureClass: null
      });
    } catch (error) {
      if (looksLikeMissingExecutable(error)) {
        const unavailableCommand = resolved.sandboxMode === "docker" ? "docker" : resolved.command;
        logger?.warn(`Tool check skipped because ${unavailableCommand} is unavailable.`);
        results.push({
          name: toolName,
          kind: "command",
          ok: false,
          skipped: true,
          issueCount: 0,
          durationMs: Date.now() - startedAt,
          summary: `Skipped ${toolName}: ${unavailableCommand} is unavailable.`,
          command: resolved.command,
          args: resolved.args,
          scope: resolved.scope,
          sandboxMode: resolved.sandboxMode,
          sandboxImage: resolved.image,
          sandboxImageProfile: resolved.imageProfile,
          workingDirectory: resolved.workingDirectory,
          checkStatus: "unavailable" as ToolCheckStatus,
          failureClass: null
        });
        continue;
      }

      const issue = buildToolIssue(toolName, error);
      issues.push(issue);
      const normalized = error as CliCommandError | undefined;
      const failureClass: ToolCheckFailureClass | null = classifyToolFailure(error, resolved.sandboxMode);
      // B2: scope fallback — if scoped check failed, retry with full scope
      let fallbackResult: ToolCheckFailureClass | null = failureClass;
      let scopeFallback = false;
      if (resolved.scopedToChangedFiles || resolved.scope === "changed-files" || resolved.scope === "package") {
        const fallbackResolved = await resolveFullScopeFallback({
          repoRoot,
          toolName,
          toolConfig: tools.commands?.[toolName],
          packageScripts,
          packageManager,
          changedPaths: [],
          adapterContexts,
          sandbox,
          projectType
        });
        if (fallbackResolved) {
          logger?.step(`Falling back to full-scope check: ${fallbackResolved.display}${fallbackResolved.sandboxMode === "docker" ? " [sandbox=docker]" : ""}`);
          scopeFallback = true;
          try {
            const fbInvoke = buildToolInvocation(fallbackResolved, repoRoot);
            const fbResult = await runCommandWithRetry({
              command: fbInvoke.command,
              args: fbInvoke.args,
              cwd: fbInvoke.cwd,
              env: fbInvoke.env,
              timeoutMs: fallbackResolved.timeoutMs,
              retries: fallbackResolved.retries,
              baseDelayMs: fallbackResolved.baseDelayMs,
              label: fallbackResolved.display,
              signal
            });
            results.push({
              name: toolName,
              kind: "command",
              ok: true,
              skipped: false,
              issueCount: 0,
              durationMs: Date.now() - startedAt,
              summary: `${toolName} passed (full-scope fallback).`,
              command: fallbackResolved.command,
              args: fallbackResolved.args,
              scope: fallbackResolved.scope,
              sandboxMode: fallbackResolved.sandboxMode,
              sandboxImage: fallbackResolved.image,
              sandboxImageProfile: fallbackResolved.imageProfile,
              workingDirectory: fallbackResolved.workingDirectory,
              exitCode: fbResult.code,
              stdout: truncate(fbResult.stdout.trim(), 1200),
              stderr: truncate(fbResult.stderr.trim(), 1200),
              checkStatus: "passed" as ToolCheckStatus,
              failureClass: null,
              scopeFallback: true
            });
            continue;
          } catch {
            // fallback also failed — keep original failure
            fallbackResult = classifyToolFailure(error, fallbackResolved.sandboxMode);
          }
        }
      }

      results.push({
        name: toolName,
        kind: "command",
        ok: false,
        skipped: false,
        issueCount: 1,
        durationMs: Date.now() - startedAt,
        summary: scopeFallback ? `${toolName} failed (full-scope fallback also failed).` : `${toolName} failed.`,
        command: resolved.command,
        args: resolved.args,
        scope: resolved.scope,
        sandboxMode: resolved.sandboxMode,
        sandboxImage: resolved.image,
        sandboxImageProfile: resolved.imageProfile,
        workingDirectory: resolved.workingDirectory,
        exitCode: typeof normalized?.code === "number" ? normalized.code : null,
        stdout: truncate(`${normalized?.stdout ?? ""}`.trim(), 1200),
        stderr: truncate(`${normalized?.stderr ?? ""}`.trim(), 1200),
        checkStatus: "failed" as ToolCheckStatus,
        failureClass: fallbackResult,
        scopeFallback
      });
    }
  }

  return { results, issues };
}

export async function summarizeConfiguredTools({
  repoRoot,
  rules
}: {
  repoRoot: string;
  rules: RulesConfig;
}): Promise<ToolConfigurationSummary[]> {
  const tools = rules.tools ?? {};
  const packageJson = await readPackageJson(path.join(repoRoot, "package.json"));
  const packageScripts = normalizeScripts(packageJson);
  const packageManager = await detectPackageManager(repoRoot);
  const sandbox = resolveToolSandbox(tools.sandbox);
  const projectType = String(tools.project_type ?? "auto");
  const adapterContexts = await detectToolAdapterContexts(repoRoot, ["{changed-file-example}"], tools);

  const summaries: ToolConfigurationSummary[] = [];
  for (const toolName of ["lint", "typecheck", "build", "test"] as ToolExecutionName[]) {
    const toolConfig = tools.commands?.[toolName];
    let resolved = await resolveToolCommand({
      repoRoot,
      toolName,
      toolConfig,
      packageScripts,
      packageManager,
      changedPaths: ["{changed-file-example}"],
      adapterContexts,
      sandbox,
      projectType
    });

    if (tools.enabled === false || toolConfig?.enabled === false) {
      summaries.push({
        name: toolName,
        enabled: false,
        source: "disabled",
        summary: `${toolName} is disabled.`
      });
      continue;
    }

    if (!resolved) {
      summaries.push({
        name: toolName,
        enabled: false,
        source: "none",
        summary: `No configured or detected command for ${toolName}.`
      });
      continue;
    }

    resolved = applyResolvedSandboxImage(resolved, sandbox, repoRoot, resolved.imageProfile ?? projectType);
    summaries.push({
      name: toolName,
      enabled: true,
      source: resolved.source,
      command: resolved.command,
      args: resolved.args,
      scopedToChangedFiles: resolved.scopedToChangedFiles,
      scope: resolved.scope,
      sandboxMode: resolved.sandboxMode,
      sandboxImage: resolved.image,
      sandboxImageProfile: resolved.imageProfile,
      workingDirectory: resolved.workingDirectory,
      summary: `${toolName} -> ${resolved.display}${resolved.workingDirectory ? ` (cwd=${resolved.workingDirectory})` : ""}${resolved.scope !== "full" ? ` [scope=${resolved.scope}]` : ""}${resolved.sandboxMode !== "inherit" ? ` [sandbox=${resolved.sandboxMode}${resolved.image ? ` image=${resolved.image}` : ""}]` : ""}`
    });
  }

  return summaries;
}

export async function createDryRunToolExecutionSummary({
  repoRoot,
  rules,
  reason = "Skipped command-based tool checks in dry-run mode because the isolated repo context is incomplete."
}: {
  repoRoot: string;
  rules: RulesConfig;
  reason?: string;
}): Promise<ToolExecutionSummary> {
  const summaries = await summarizeConfiguredTools({ repoRoot, rules });
  return {
    results: summaries.map((tool) => ({
      name: tool.name,
      kind: "command",
      ok: false,
      skipped: true,
      issueCount: 0,
      durationMs: 0,
      summary:
        tool.enabled === false || tool.source === "disabled"
          ? `${tool.name} is disabled.`
          : tool.source === "none"
            ? `Skipped ${tool.name}: no configured or detected command.`
            : `Skipped ${tool.name}: ${reason}`,
      command: tool.command,
      args: tool.args,
      scope: tool.scope,
      sandboxMode: tool.sandboxMode,
      sandboxImage: tool.sandboxImage,
      sandboxImageProfile: tool.sandboxImageProfile,
      workingDirectory: tool.workingDirectory
    })),
    issues: []
  };
}

async function readPackageJson(packageJsonPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeScripts(packageJson: Record<string, unknown> | null): Record<string, string> {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return {};

  return Object.fromEntries(
    Object.entries(scripts)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, String(value)])
  );
}

async function detectPackageManager(repoRoot: string): Promise<"pnpm" | "yarn" | "npm"> {
  const checks: Array<{ name: "pnpm" | "yarn" | "npm"; file: string }> = [
    { name: "pnpm", file: "pnpm-lock.yaml" },
    { name: "yarn", file: "yarn.lock" },
    { name: "npm", file: "package-lock.json" }
  ];

  for (const check of checks) {
    try {
      await fs.access(path.join(repoRoot, check.file));
      return check.name;
    } catch {
      continue;
    }
  }

  return "npm";
}
