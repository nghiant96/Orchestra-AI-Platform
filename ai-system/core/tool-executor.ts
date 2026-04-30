import fs from "node:fs/promises";
import path from "node:path";
import { runCommandWithRetry } from "../utils/api.js";
import { truncate } from "../utils/string.js";
import { buildBuiltinToolAdapters } from "./builtin-tool-adapters.js";
import { resolveSandboxImage, resolveToolSandbox } from "./tool-sandbox.js";
import type {
  CliCommandError,
  GeneratedFile,
  Logger,
  ReviewIssue,
  RulesConfig,
  ToolAdapterConfig,
  ToolCommandConfig,
  ToolConfigurationSummary,
  ToolExecutionScope,
  ToolExecutionName,
  ToolExecutionResult,
  ToolExecutionSummary,
  ToolSandboxMode
} from "../types.js";

const DEFAULT_TOOL_TIMEOUT_MS: Record<string, number> = {
  lint: 120000,
  typecheck: 120000,
  build: 180000,
  test: 180000
};

const DEFAULT_TOOL_RETRIES: Record<string, number> = {
  lint: 0,
  typecheck: 0,
  build: 0,
  test: 0
};

const DEFAULT_TOOL_BASE_DELAY_MS = 500;

interface ResolvedToolCommand {
  name: ToolExecutionName;
  command: string;
  args: string[];
  display: string;
  cwd: string;
  timeoutMs: number;
  retries: number;
  baseDelayMs: number;
  source: ToolConfigurationSummary["source"];
  scopedToChangedFiles: boolean;
  scope: ToolExecutionScope;
  sandboxMode: ToolSandboxMode;
  image?: string;
  imageProfile?: string;
  autoBuild?: boolean;
  dockerfile?: string;
  buildHint?: string;
  env: NodeJS.ProcessEnv;
  workingDirectory?: string;
}

interface PackageScopeContext {
  cwd: string;
  packageScripts: Record<string, string>;
  packageManager: "pnpm" | "yarn" | "npm";
  relativeChangedPaths: string[];
  workingDirectory: string;
  tsconfigPath?: string;
}

interface WorkspacePackageContext {
  name: string;
  cwd: string;
  workingDirectory: string;
  packageScripts: Record<string, string>;
}

interface WorkspaceScopeContext {
  repoRoot: string;
  packageManager: "pnpm";
  packages: WorkspacePackageContext[];
}

interface ToolAdapterContext {
  name: string;
  cwd: string;
  workingDirectory: string;
  commands: Partial<Record<ToolExecutionName, ToolCommandConfig>>;
  changedFileExtensions: string[];
}

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
  if (signal?.aborted) throw new Error('AbortError');
  const issues: ReviewIssue[] = [];
  const results: ToolExecutionResult[] = [];
  const tools = rules.tools ?? {};

  if (tools.json_validation !== false) {
    const validation = runJsonValidation(changedFiles);
    issues.push(...validation.issues);
    results.push(validation.result);
  }

  if (tools.enabled === false) {
    return { results, issues };
  }

  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = await readPackageJson(packageJsonPath);
  const packageScripts = normalizeScripts(packageJson);
  const packageManager = await detectPackageManager(repoRoot);
  const changedPaths = changedFiles.map((file) => file.path).filter(Boolean);
  const sandbox = resolveToolSandbox(tools.sandbox);
  const projectType = String(tools.project_type ?? "auto");
  const adapterContexts = await detectToolAdapterContexts(repoRoot, changedPaths, tools);

  const toolNames = Object.keys(tools.commands || {}) as ToolExecutionName[];
  // Ensure basic tools are at least checked if not defined but detected
  const standardTools: ToolExecutionName[] = ["lint", "typecheck", "build", "test"];
  for (const st of standardTools) {
    if (!toolNames.includes(st)) toolNames.push(st);
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
        summary: `Skipped ${toolName}: no configured or detected command.`
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
          workingDirectory: resolved.workingDirectory
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
        stderr: truncate(commandResult.stderr.trim(), 1200)
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
          workingDirectory: resolved.workingDirectory
        });
        continue;
      }

      const issue = buildToolIssue(toolName, error);
      issues.push(issue);
      const normalized = error as CliCommandError | undefined;
      results.push({
        name: toolName,
        kind: "command",
        ok: false,
        skipped: false,
        issueCount: 1,
        durationMs: Date.now() - startedAt,
        summary: `${toolName} failed.`,
        command: resolved.command,
        args: resolved.args,
        scope: resolved.scope,
        sandboxMode: resolved.sandboxMode,
        sandboxImage: resolved.image,
        sandboxImageProfile: resolved.imageProfile,
        workingDirectory: resolved.workingDirectory,
        exitCode: typeof normalized?.code === "number" ? normalized.code : null,
        stdout: truncate(`${normalized?.stdout ?? ""}`.trim(), 1200),
        stderr: truncate(`${normalized?.stderr ?? ""}`.trim(), 1200)
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
  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = await readPackageJson(packageJsonPath);
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

function runJsonValidation(changedFiles: GeneratedFile[]): { result: ToolExecutionResult; issues: ReviewIssue[] } {
  const issues: ReviewIssue[] = [];

  for (const file of changedFiles) {
    if (!file?.path?.endsWith(".json")) {
      continue;
    }

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

function buildToolInvocation(
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
    if (value !== undefined) {
      dockerEnvArgs.push("--env", key);
    }
  }

  const relativeExecutionDir = normalizePath(path.relative(repoRoot, resolved.cwd));
  const containerWorkingDirectory =
    !relativeExecutionDir || relativeExecutionDir === "."
      ? "/workspace"
      : `/workspace/${relativeExecutionDir}`;

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

async function resolveToolCommand({
  repoRoot,
  toolName,
  toolConfig,
  packageScripts,
  packageManager,
  changedPaths,
  adapterContexts,
  sandbox,
  projectType
}: {
  repoRoot: string;
  toolName: ToolExecutionName;
  toolConfig: ToolCommandConfig | undefined;
  packageScripts: Record<string, string>;
  packageManager: "pnpm" | "yarn" | "npm";
  changedPaths: string[];
  adapterContexts: ToolAdapterContext[];
  sandbox: ReturnType<typeof resolveToolSandbox>;
  projectType: string;
}): Promise<ResolvedToolCommand | null> {
  const packageScope =
    toolName === "lint" || toolName === "test" || toolName === "typecheck" || toolName === "build"
      ? await detectPackageScopeContext(repoRoot, changedPaths, packageManager)
      : null;
  const workspaceScope =
    toolName === "lint" || toolName === "test" || toolName === "typecheck" || toolName === "build"
      ? await detectWorkspaceScopeContext(repoRoot, changedPaths, packageManager)
      : null;

  if (toolConfig?.enabled === false) {
    return null;
  }

  if (toolConfig?.command) {
    const args = expandToolArgs((toolConfig.args ?? []).map(String), changedPaths, toolConfig.append_changed_files === true);
    return {
      name: toolName,
      command: toolConfig.command,
      args,
      display: [toolConfig.command, ...args].join(" ").trim(),
      cwd: repoRoot,
      timeoutMs: numberOrDefault(toolConfig.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
      retries: numberOrDefault(toolConfig.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
      baseDelayMs: numberOrDefault(toolConfig.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
      source: "configured-command",
      scopedToChangedFiles: usesChangedFilePlaceholder(toolConfig.args ?? []) || toolConfig.append_changed_files === true,
      scope:
        usesChangedFilePlaceholder(toolConfig.args ?? []) || toolConfig.append_changed_files === true ? "changed-files" : "full",
      sandboxMode: sandbox.mode,
      image: sandbox.image,
      imageProfile: projectType,
      env: sandbox.env
    };
  }

  if (!toolConfig?.script) {
    const scopedAutoCommand = resolveAutoScopedToolCommand(repoRoot, toolName, toolConfig, packageScripts, packageManager, changedPaths, packageScope, sandbox);
    if (scopedAutoCommand) {
      return scopedAutoCommand;
    }
  }

  if (!toolConfig?.script && workspaceScope) {
    const workspaceCommand = resolveWorkspaceToolCommand(toolName, workspaceScope, toolConfig, sandbox);
    if (workspaceCommand) {
      return workspaceCommand;
    }
  }

  if (toolName === "typecheck" && !toolConfig?.script && packageScope?.tsconfigPath) {
    const packageTypecheckCommand = await resolvePackageTypecheckCommand(toolName, repoRoot, packageScope, toolConfig, sandbox);
    if (packageTypecheckCommand) {
      return packageTypecheckCommand;
    }
  }

  if (!toolConfig?.script && packageScope) {
    const packageScriptName = resolveToolScriptName(toolName, undefined, packageScope.packageScripts);
    if (packageScriptName) {
      return buildScriptCommand(toolName, packageScriptName, packageScope.packageManager, toolConfig, packageScope.relativeChangedPaths, {
        cwd: packageScope.cwd,
        scope: "package",
        sandbox,
        workingDirectory: packageScope.workingDirectory
      });
    }
  }

  const scriptName = resolveToolScriptName(toolName, toolConfig, packageScripts);
  if (scriptName) {
    return buildScriptCommand(toolName, scriptName, packageManager, toolConfig, changedPaths, {
      cwd: repoRoot,
      scope: toolConfig?.append_changed_files === true || usesChangedFilePlaceholder(toolConfig?.args ?? []) ? "changed-files" : "full",
      sandbox
    });
  }

  const adapterCommand = resolveAdapterToolCommand(toolName, adapterContexts, toolConfig, changedPaths, sandbox);
  if (adapterCommand) {
    return adapterCommand;
  }
  if (changedPaths.length > 0 && allChangedPathsHandledByAdapters(changedPaths, adapterContexts)) {
    return null;
  }

  if (toolName === "typecheck") {
    if (packageScope?.tsconfigPath) {
      const packageTypecheckCommand = await resolvePackageTypecheckCommand(toolName, repoRoot, packageScope, toolConfig, sandbox);
      if (packageTypecheckCommand) {
        return packageTypecheckCommand;
      }
    }

    const tsConfigPath = path.join(repoRoot, "tsconfig.json");
    try {
      await fs.access(tsConfigPath);
      return {
        name: toolName,
        command: "node",
        args: ["./node_modules/typescript/bin/tsc", "--noEmit", "-p", tsConfigPath],
        display: "node ./node_modules/typescript/bin/tsc --noEmit",
        cwd: repoRoot,
        timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
        retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
        baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
        source: "fallback",
        scopedToChangedFiles: false,
        scope: "full",
        sandboxMode: sandbox.mode,
        image: sandbox.image,
        env: sandbox.env
      };
    } catch {
      return null;
    }
  }

  return null;
}

function resolveAdapterToolCommand(
  toolName: ToolExecutionName,
  adapterContexts: ToolAdapterContext[],
  toolConfig: ToolCommandConfig | undefined,
  changedPaths: string[],
  sandbox: ReturnType<typeof resolveToolSandbox>
): ResolvedToolCommand | null {
  for (const adapter of adapterContexts) {
    const adapterCommandConfig = adapter.commands[toolName];
    if (!adapterCommandConfig || adapterCommandConfig.enabled === false) {
      continue;
    }

    const adapterChangedPaths = filterChangedPathsForAdapter(changedPaths, adapter);
    const args = expandToolArgs(
      (adapterCommandConfig.args ?? []).map(String),
      adapterChangedPaths,
      adapterCommandConfig.append_changed_files === true
    );
    if (!adapterCommandConfig.command) {
      continue;
    }

    return {
      name: toolName,
      command: adapterCommandConfig.command,
      args,
      display: [adapterCommandConfig.command, ...args].join(" ").trim(),
      cwd: adapter.cwd,
      timeoutMs: numberOrDefault(adapterCommandConfig.timeout_ms ?? toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
      retries: numberOrDefault(adapterCommandConfig.retries ?? toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
      baseDelayMs: numberOrDefault(adapterCommandConfig.base_delay_ms ?? toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
      source: "adapter",
      scopedToChangedFiles: usesChangedFilePlaceholder(adapterCommandConfig.args ?? []) || adapterCommandConfig.append_changed_files === true,
      scope: adapter.workingDirectory === "." ? "full" : "package",
      sandboxMode: sandbox.mode,
      image: sandbox.image,
      imageProfile: adapter.name,
      env: sandbox.env,
      workingDirectory: adapter.workingDirectory
    };
  }

  return null;
}

function applyResolvedSandboxImage(
  resolved: ResolvedToolCommand,
  sandbox: ReturnType<typeof resolveToolSandbox>,
  repoRoot: string,
  projectType: string
): ResolvedToolCommand {
  if (resolved.sandboxMode !== "docker") {
    return resolved;
  }

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

async function preflightDockerSandbox(
  resolved: ResolvedToolCommand,
  repoRoot: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; summary: string }> {
  if (resolved.sandboxMode !== "docker") {
    return { ok: true, summary: "" };
  }

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

function resolveToolScriptName(
  toolName: ToolExecutionName,
  toolConfig: ToolCommandConfig | undefined,
  packageScripts: Record<string, string>
): string | null {
  if (typeof toolConfig?.script === "string" && toolConfig.script.trim()) {
    return toolConfig.script.trim();
  }

  const scriptCandidates =
    toolName === "typecheck"
      ? ["type-check", "typecheck"]
      : [toolName];

  for (const candidate of scriptCandidates) {
    if (typeof packageScripts[candidate] === "string") {
      return candidate;
    }
  }

  return null;
}

function buildScriptCommand(
  toolName: ToolExecutionName,
  scriptName: string,
  packageManager: "pnpm" | "yarn" | "npm",
  toolConfig: ToolCommandConfig | undefined,
  changedPaths: string[],
  options?: {
    cwd?: string;
    scope?: ToolExecutionScope;
    sandbox: ReturnType<typeof resolveToolSandbox>;
    workingDirectory?: string;
  }
): ResolvedToolCommand {
  const extraArgs = expandToolArgs((toolConfig?.args ?? []).map(String), changedPaths, toolConfig?.append_changed_files === true);
  const scopedToChangedFiles = usesChangedFilePlaceholder(toolConfig?.args ?? []) || toolConfig?.append_changed_files === true;
  const source: ToolConfigurationSummary["source"] =
    typeof toolConfig?.script === "string" && toolConfig.script.trim() ? "configured-script" : "auto-detected-script";
  const cwd = options?.cwd ?? process.cwd();
  const scope = options?.scope ?? (scopedToChangedFiles ? "changed-files" : "full");

  switch (packageManager) {
    case "pnpm":
      return {
        name: toolName,
        command: "pnpm",
        args: ["run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])],
        display: ["pnpm", "run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])].join(" "),
        cwd,
        timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
        retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
        baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
        source,
        scopedToChangedFiles,
        scope,
        sandboxMode: options?.sandbox.mode ?? "inherit",
        image: options?.sandbox.image,
        env: options?.sandbox.env ?? { ...process.env },
        workingDirectory: options?.workingDirectory
      };
    case "yarn":
      return {
        name: toolName,
        command: "yarn",
        args: [scriptName, ...extraArgs],
        display: ["yarn", scriptName, ...extraArgs].join(" "),
        cwd,
        timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
        retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
        baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
        source,
        scopedToChangedFiles,
        scope,
        sandboxMode: options?.sandbox.mode ?? "inherit",
        image: options?.sandbox.image,
        env: options?.sandbox.env ?? { ...process.env },
        workingDirectory: options?.workingDirectory
      };
    case "npm":
    default:
      return {
        name: toolName,
        command: "npm",
        args: ["run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])],
        display: ["npm", "run", scriptName, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])].join(" "),
        cwd,
        timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
        retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
        baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
        source,
        scopedToChangedFiles,
        scope,
        sandboxMode: options?.sandbox.mode ?? "inherit",
        image: options?.sandbox.image,
        env: options?.sandbox.env ?? { ...process.env },
        workingDirectory: options?.workingDirectory
      };
  }
}

function resolveAutoScopedToolCommand(
  repoRoot: string,
  toolName: ToolExecutionName,
  toolConfig: ToolCommandConfig | undefined,
  packageScripts: Record<string, string>,
  packageManager: "pnpm" | "yarn" | "npm",
  changedPaths: string[],
  packageScope: PackageScopeContext | null,
  sandbox: ReturnType<typeof resolveToolSandbox>
): ResolvedToolCommand | null {
  if (changedPaths.length === 0 || (toolName !== "lint" && toolName !== "test")) {
    return null;
  }

  const scopedCandidates = getScopedScriptCandidates(toolName);
  for (const candidate of scopedCandidates) {
    if (packageScope && typeof packageScope.packageScripts[candidate.script] === "string") {
      return buildScriptCommand(toolName, candidate.script, packageScope.packageManager, {
        append_changed_files: candidate.appendChangedFiles
      }, packageScope.relativeChangedPaths, {
        cwd: packageScope.cwd,
        scope: candidate.appendChangedFiles ? "changed-files" : "package",
        sandbox,
        workingDirectory: packageScope.workingDirectory
      });
    }

    if (typeof packageScripts[candidate.script] === "string") {
      return buildScriptCommand(toolName, candidate.script, packageManager, {
        append_changed_files: candidate.appendChangedFiles
      }, changedPaths, {
        cwd: repoRoot,
        scope: candidate.appendChangedFiles ? "changed-files" : "full",
        sandbox
      });
    }
  }

  const directPackageLintCommand = resolveDirectPackageLintCommand(toolName, packageScope, toolConfig, sandbox);
  if (directPackageLintCommand) {
    return directPackageLintCommand;
  }

  return null;
}

function getScopedScriptCandidates(toolName: ToolExecutionName): Array<{ script: string; appendChangedFiles: boolean }> {
  if (toolName === "lint") {
    return [
      { script: "lint:changed", appendChangedFiles: true },
      { script: "lint:files", appendChangedFiles: true },
      { script: "lint:staged", appendChangedFiles: true }
    ];
  }

  if (toolName === "test") {
    return [
      { script: "test:changed", appendChangedFiles: true },
      { script: "test:related", appendChangedFiles: true },
      { script: "test:staged", appendChangedFiles: true },
      { script: "test:affected", appendChangedFiles: false },
      { script: "affected:test", appendChangedFiles: false }
    ];
  }

  return [];
}

function resolveDirectPackageLintCommand(
  toolName: ToolExecutionName,
  packageScope: PackageScopeContext | null,
  toolConfig: ToolCommandConfig | undefined,
  sandbox: ReturnType<typeof resolveToolSandbox>
): ResolvedToolCommand | null {
  if (toolName !== "lint" || !packageScope || packageScope.relativeChangedPaths.length === 0) {
    return null;
  }

  const lintScript = packageScope.packageScripts.lint;
  if (!lintScript || !isGenericEslintScript(lintScript)) {
    return null;
  }

  const lintablePaths = packageScope.relativeChangedPaths.filter(isEslintablePath);
  if (lintablePaths.length === 0) {
    return null;
  }

  const args = buildPackageManagerExecArgs(packageScope.packageManager, "eslint", lintablePaths);
  return {
    name: toolName,
    command: packageScope.packageManager,
    args,
    display: [packageScope.packageManager, ...args].join(" "),
    cwd: packageScope.cwd,
    timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
    retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
    baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
    source: "fallback",
    scopedToChangedFiles: true,
    scope: "changed-files",
    sandboxMode: sandbox.mode,
    image: sandbox.image,
    env: sandbox.env,
    workingDirectory: packageScope.workingDirectory
  };
}

function isGenericEslintScript(script: string): boolean {
  return /^eslint\s+\.?(?:\s|$)/.test(script.trim());
}

function isEslintablePath(filePath: string): boolean {
  return [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].includes(path.extname(filePath).toLowerCase());
}

function buildPackageManagerExecArgs(
  packageManager: "pnpm" | "yarn" | "npm",
  binary: string,
  args: string[]
): string[] {
  if (packageManager === "npm") {
    return ["exec", binary, "--", ...args];
  }
  if (packageManager === "yarn") {
    return [binary, ...args];
  }
  return ["exec", binary, ...args];
}

async function detectPackageScopeContext(
  repoRoot: string,
  changedPaths: string[],
  packageManager: "pnpm" | "yarn" | "npm"
): Promise<PackageScopeContext | null> {
  if (changedPaths.length === 0) {
    return null;
  }

  const packageDirs = new Set<string>();
  for (const changedPath of changedPaths) {
    const packageDir = await findNearestPackageDir(repoRoot, changedPath);
    if (!packageDir) {
      return null;
    }
    packageDirs.add(packageDir);
  }

  if (packageDirs.size !== 1) {
    return null;
  }

  const [packageDir] = [...packageDirs];
  if (!packageDir || path.resolve(packageDir) === path.resolve(repoRoot)) {
    return null;
  }

  const packageJson = await readPackageJson(path.join(packageDir, "package.json"));
  const packageScripts = normalizeScripts(packageJson);
  const tsconfigPath = await findPackageTsconfigPath(packageDir);

  return {
    cwd: packageDir,
    packageScripts,
    packageManager,
    relativeChangedPaths: changedPaths.map((changedPath) =>
      normalizePath(path.relative(packageDir, path.join(repoRoot, changedPath)))
    ),
    workingDirectory: normalizePath(path.relative(repoRoot, packageDir)) || ".",
    ...(tsconfigPath ? { tsconfigPath } : {})
  };
}

async function detectWorkspaceScopeContext(
  repoRoot: string,
  changedPaths: string[],
  packageManager: "pnpm" | "yarn" | "npm"
): Promise<WorkspaceScopeContext | null> {
  if (packageManager !== "pnpm" || changedPaths.length === 0) {
    return null;
  }

  try {
    await fs.access(path.join(repoRoot, "pnpm-workspace.yaml"));
  } catch {
    return null;
  }

  const packageDirs = new Set<string>();
  for (const changedPath of changedPaths) {
    const packageDir = await findNearestPackageDir(repoRoot, changedPath);
    if (!packageDir || path.resolve(packageDir) === path.resolve(repoRoot)) {
      return null;
    }
    packageDirs.add(packageDir);
  }

  if (packageDirs.size <= 1) {
    return null;
  }

  const packages: WorkspacePackageContext[] = [];
  for (const packageDir of packageDirs) {
    const packageJson = await readPackageJson(path.join(packageDir, "package.json"));
    const packageName = typeof packageJson?.name === "string" ? packageJson.name.trim() : "";
    if (!packageName) {
      return null;
    }
    packages.push({
      name: packageName,
      cwd: packageDir,
      workingDirectory: normalizePath(path.relative(repoRoot, packageDir)) || ".",
      packageScripts: normalizeScripts(packageJson)
    });
  }

  return {
    repoRoot,
    packageManager: "pnpm",
    packages
  };
}

function resolveWorkspaceToolCommand(
  toolName: ToolExecutionName,
  workspaceScope: WorkspaceScopeContext,
  toolConfig: ToolCommandConfig | undefined,
  sandbox: ReturnType<typeof resolveToolSandbox>
): ResolvedToolCommand | null {
  const scriptName = resolveWorkspaceScriptName(toolName, workspaceScope.packages);
  if (!scriptName) {
    return null;
  }

  const filters = workspaceScope.packages.flatMap((pkg) => ["--filter", pkg.name]);
  return {
    name: toolName,
    command: "pnpm",
    args: [...filters, "run", scriptName],
    display: ["pnpm", ...filters, "run", scriptName].join(" "),
    cwd: workspaceScope.repoRoot,
    timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
    retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
    baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
    source: "auto-detected-script",
    scopedToChangedFiles: false,
    scope: "workspace",
    sandboxMode: sandbox.mode,
    image: sandbox.image,
    env: sandbox.env,
    workingDirectory: workspaceScope.packages.map((pkg) => pkg.workingDirectory).join(",")
  };
}

function resolveWorkspaceScriptName(
  toolName: ToolExecutionName,
  packages: WorkspacePackageContext[]
): string | null {
  if (packages.length === 0) {
    return null;
  }

  const scriptNames = packages.map((pkg) => resolveToolScriptName(toolName, undefined, pkg.packageScripts));
  const [first] = scriptNames;
  if (!first) {
    return null;
  }

  return scriptNames.every((scriptName) => scriptName === first) ? first : null;
}

async function resolvePackageTypecheckCommand(
  toolName: ToolExecutionName,
  repoRoot: string,
  packageScope: PackageScopeContext,
  toolConfig: ToolCommandConfig | undefined,
  sandbox: ReturnType<typeof resolveToolSandbox>
): Promise<ResolvedToolCommand | null> {
  const tscPath = await findTypescriptCompilerPath(packageScope.cwd, repoRoot);
  const tsconfigPath = packageScope.tsconfigPath;
  if (!tscPath || !tsconfigPath) {
    return null;
  }

  return {
    name: toolName,
    command: "node",
    args: [tscPath, "--noEmit", "-p", tsconfigPath],
    display: `node ${tscPath} --noEmit -p ${tsconfigPath}`,
    cwd: packageScope.cwd,
    timeoutMs: numberOrDefault(toolConfig?.timeout_ms, DEFAULT_TOOL_TIMEOUT_MS[toolName] || 120000),
    retries: numberOrDefault(toolConfig?.retries, DEFAULT_TOOL_RETRIES[toolName] || 0),
    baseDelayMs: numberOrDefault(toolConfig?.base_delay_ms, DEFAULT_TOOL_BASE_DELAY_MS),
    source: "fallback",
    scopedToChangedFiles: false,
    scope: "package",
    sandboxMode: sandbox.mode,
    image: sandbox.image,
    env: sandbox.env,
    workingDirectory: packageScope.workingDirectory
  };
}

async function findTypescriptCompilerPath(packageDir: string, repoRoot: string): Promise<string | null> {
  const candidates = [
    path.join(packageDir, "node_modules", "typescript", "bin", "tsc"),
    path.join(repoRoot, "node_modules", "typescript", "bin", "tsc")
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function findNearestPackageDir(repoRoot: string, changedPath: string): Promise<string | null> {
  let currentDir = path.dirname(path.join(repoRoot, changedPath));
  const resolvedRepoRoot = path.resolve(repoRoot);

  while (currentDir.startsWith(resolvedRepoRoot)) {
    try {
      await fs.access(path.join(currentDir, "package.json"));
      return currentDir;
    } catch {
      // continue walking
    }

    if (currentDir === resolvedRepoRoot) {
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

async function findPackageTsconfigPath(packageDir: string): Promise<string | undefined> {
  const candidates = ["tsconfig.json", "tsconfig.build.json"];
  for (const candidate of candidates) {
    const candidatePath = path.join(packageDir, candidate);
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function detectToolAdapterContexts(
  repoRoot: string,
  changedPaths: string[],
  tools: NonNullable<RulesConfig["tools"]>
): Promise<ToolAdapterContext[]> {
  const projectType = String(tools.project_type ?? "auto");
  const adapters = [
    ...buildConfiguredToolAdapters(tools.adapters ?? {}),
    ...buildBuiltinToolAdapters(projectType, DEFAULT_TOOL_TIMEOUT_MS)
  ];
  const contexts: ToolAdapterContext[] = [];

  for (const adapter of adapters) {
    if (adapter.enabled === false) {
      continue;
    }
    if (!shouldConsiderAdapter(adapter.name, projectType)) {
      continue;
    }
    if (!changedPathsMatchAdapter(changedPaths, adapter.changed_file_extensions ?? [])) {
      continue;
    }

    const workingDirectory = normalizeAdapterWorkingDirectory(adapter.working_directory);
    const cwd = path.resolve(repoRoot, workingDirectory);
    if (!isPathWithinRepo(repoRoot, cwd)) {
      continue;
    }
    if (!(await adapterDetected(cwd, adapter.detect_files ?? []))) {
      continue;
    }

    if (adapter.name === "python") {
      const pythonContext = await resolvePythonAdapterContext(cwd, repoRoot, adapter);
      if (pythonContext) {
        contexts.push(pythonContext);
        continue;
      }
    }

    contexts.push({
      name: adapter.name,
      cwd,
      workingDirectory,
      commands: adapter.commands ?? {},
      changedFileExtensions: (adapter.changed_file_extensions ?? []).map((entry) => entry.toLowerCase())
    });
  }

  return contexts;
}

function buildConfiguredToolAdapters(adapters: Record<string, ToolAdapterConfig>): Array<ToolAdapterConfig & { name: string }> {
  return Object.entries(adapters).map(([name, adapter]) => ({ name, ...adapter }));
}

function shouldConsiderAdapter(adapterName: string, projectType: string): boolean {
  return projectType === "auto" || projectType === adapterName;
}

function changedPathsMatchAdapter(changedPaths: string[], extensions: string[]): boolean {
  if (extensions.length === 0 || changedPaths.length === 0 || changedPaths.includes("{changed-file-example}")) {
    return true;
  }
  const normalizedExtensions = extensions.map((entry) => entry.toLowerCase());
  return changedPaths.some((changedPath) => normalizedExtensions.includes(path.extname(changedPath).toLowerCase()));
}

function filterChangedPathsForAdapter(changedPaths: string[], adapter: ToolAdapterContext): string[] {
  if (adapter.changedFileExtensions.length === 0) {
    return changedPaths;
  }
  return changedPaths.filter((changedPath) =>
    adapter.changedFileExtensions.includes(path.extname(changedPath).toLowerCase())
  );
}

function allChangedPathsHandledByAdapters(changedPaths: string[], adapterContexts: ToolAdapterContext[]): boolean {
  if (adapterContexts.length === 0) {
    return false;
  }
  return changedPaths.every((changedPath) =>
    adapterContexts.some(
      (adapter) => adapter.changedFileExtensions.length === 0 || adapter.changedFileExtensions.includes(path.extname(changedPath).toLowerCase())
    )
  );
}

function normalizeAdapterWorkingDirectory(workingDirectory: unknown): string {
  if (typeof workingDirectory !== "string" || !workingDirectory.trim()) {
    return ".";
  }
  return normalizePath(workingDirectory.trim()).replace(/^\.\/+/, "") || ".";
}

async function adapterDetected(cwd: string, detectFiles: string[]): Promise<boolean> {
  if (detectFiles.length === 0) {
    return true;
  }
  for (const detectFile of detectFiles) {
    try {
      await fs.access(path.join(cwd, detectFile));
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function isPathWithinRepo(repoRoot: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
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
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return {};
  }

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

function buildToolIssue(toolName: ToolExecutionName, error: unknown): ReviewIssue {
  return {
    severity: "medium",
    category: `tool:${toolName}`,
    path: "",
    description: `${toolName} failed:\n${formatCommandOutput(error)}`,
    suggestedFix: `Fix the reported ${toolName} errors before accepting the generated files.`
  };
}

function looksLikeMissingExecutable(error: unknown): boolean {
  const message = `${(error as Error | undefined)?.message ?? ""}`.toLowerCase();
  return message.includes("failed to start") || message.includes("enoent");
}

function formatCommandOutput(error: unknown): string {
  const normalized = error as CliCommandError | undefined;
  const output = [normalized?.stderr, normalized?.stdout, normalized?.message]
    .filter(Boolean)
    .join("\n")
    .trim();

  return truncate(output || "Unknown tool execution failure.", 1200);
}

function numberOrDefault(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function expandToolArgs(args: string[], changedPaths: string[], appendChangedFiles: boolean): string[] {
  const output: string[] = [];

  for (const arg of args) {
    if (arg === "{changed_files}") {
      output.push(...changedPaths);
      continue;
    }
    if (arg === "{changed_files_csv}") {
      output.push(changedPaths.join(","));
      continue;
    }
    output.push(arg);
  }

  if (appendChangedFiles) {
    output.push(...changedPaths);
  }

  return output;
}

function usesChangedFilePlaceholder(args: string[] | undefined): boolean {
  return (args ?? []).some((arg) => arg === "{changed_files}" || arg === "{changed_files_csv}");
}

async function resolvePythonAdapterContext(cwd: string, repoRoot: string, baseAdapter: any): Promise<ToolAdapterContext | null> {
  const detectFiles = ["pyproject.toml", "requirements.txt", "Pipfile", "poetry.lock", "uv.lock", "setup.py"];
  if (!(await adapterDetected(cwd, detectFiles))) {
    return null;
  }

  // Detect Package Manager
  let pm: "uv" | "poetry" | "pipenv" | "pip" = "pip";
  if (await pathExists(path.join(cwd, "uv.lock"))) pm = "uv";
  else if (await pathExists(path.join(cwd, "poetry.lock"))) pm = "poetry";
  else if (await pathExists(path.join(cwd, "Pipfile"))) pm = "pipenv";

  const runPrefix = pm === "uv" ? ["uv", "run"] : 
                   pm === "poetry" ? ["poetry", "run"] : 
                   pm === "pipenv" ? ["pipenv", "run"] : 
                   ["python", "-m"];

  const commands: Partial<Record<ToolExecutionName, ToolCommandConfig>> = { ...baseAdapter.commands };

  // Smart Tool Detection
  const hasRuff = await adapterDetected(cwd, ["ruff.toml", ".ruff.toml"]) || await checkPyprojectForTool(cwd, "ruff");
  const hasMypy = await adapterDetected(cwd, ["mypy.ini", ".mypy.ini"]) || await checkPyprojectForTool(cwd, "mypy");
  const hasPytest = await adapterDetected(cwd, ["pytest.ini", "conftest.py"]) || await checkPyprojectForTool(cwd, "pytest");

  if (!commands.lint) {
    if (hasRuff) {
      commands.lint = { command: runPrefix[0], args: [...runPrefix.slice(1), "ruff", "check", "."] };
    } else {
      commands.lint = { command: runPrefix[0], args: [...runPrefix.slice(1), "flake8", "."] };
    }
  }

  if (!commands.typecheck) {
    if (hasMypy) {
      commands.typecheck = { command: runPrefix[0], args: [...runPrefix.slice(1), "mypy", "."] };
    }
  }

  if (!commands.test) {
    if (hasPytest) {
      commands.test = { command: runPrefix[0], args: [...runPrefix.slice(1), "pytest"] };
    } else {
      commands.test = { command: runPrefix[0], args: [...runPrefix.slice(1), "unittest", "discover"] };
    }
  }

  return {
    name: "python",
    cwd,
    workingDirectory: normalizePath(path.relative(repoRoot, cwd)) || ".",
    commands,
    changedFileExtensions: [".py"]
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function checkPyprojectForTool(cwd: string, toolName: string): Promise<boolean> {
  const p = path.join(cwd, "pyproject.toml");
  try {
    const content = await fs.readFile(p, "utf8");
    return content.includes(`[tool.${toolName}]`);
  } catch {
    return false;
  }
}
