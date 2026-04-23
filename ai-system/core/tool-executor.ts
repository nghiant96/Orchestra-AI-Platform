import fs from "node:fs/promises";
import path from "node:path";
import { runCommandWithRetry } from "../utils/api.js";
import { truncate } from "../utils/string.js";
import type {
  CliCommandError,
  GeneratedFile,
  Logger,
  ReviewIssue,
  RulesConfig,
  ToolCommandConfig,
  ToolConfigurationSummary,
  ToolExecutionScope,
  ToolExecutionName,
  ToolExecutionResult,
  ToolExecutionSummary
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
  workingDirectory?: string;
}

interface PackageScopeContext {
  cwd: string;
  packageScripts: Record<string, string>;
  packageManager: "pnpm" | "yarn" | "npm";
  relativeChangedPaths: string[];
  workingDirectory: string;
}

export async function runToolChecks({
  repoRoot,
  changedFiles,
  rules,
  logger
}: {
  repoRoot: string;
  changedFiles: GeneratedFile[];
  rules: RulesConfig;
  logger?: Logger;
}): Promise<ToolExecutionSummary> {
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

  const toolNames: ToolExecutionName[] = ["lint", "typecheck", "build", "test"];
  for (const toolName of toolNames) {
    const resolved = await resolveToolCommand({
      repoRoot,
      toolName,
      toolConfig: tools.commands?.[toolName],
      packageScripts,
      packageManager,
      changedPaths
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

    logger?.step(`Running tool check: ${resolved.display}`);
    const startedAt = Date.now();

    try {
      const commandResult = await runCommandWithRetry({
        command: resolved.command,
        args: resolved.args,
        cwd: resolved.cwd,
        timeoutMs: resolved.timeoutMs,
        retries: resolved.retries,
        baseDelayMs: resolved.baseDelayMs,
        label: resolved.display
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
        workingDirectory: resolved.workingDirectory,
        exitCode: commandResult.code,
        stdout: truncate(commandResult.stdout.trim(), 1200),
        stderr: truncate(commandResult.stderr.trim(), 1200)
      });
    } catch (error) {
      if (looksLikeMissingExecutable(error)) {
        logger?.warn(`Tool check skipped because ${resolved.command} is unavailable.`);
        results.push({
          name: toolName,
          kind: "command",
          ok: false,
          skipped: true,
          issueCount: 0,
          durationMs: Date.now() - startedAt,
          summary: `Skipped ${toolName}: ${resolved.command} is unavailable.`,
          command: resolved.command,
          args: resolved.args,
          scope: resolved.scope,
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

  const summaries: ToolConfigurationSummary[] = [];
  for (const toolName of ["lint", "typecheck", "build", "test"] as ToolExecutionName[]) {
    const toolConfig = tools.commands?.[toolName];
    const resolved = await resolveToolCommand({
      repoRoot,
      toolName,
      toolConfig,
      packageScripts,
      packageManager,
      changedPaths: ["{changed-file-example}"]
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

    summaries.push({
      name: toolName,
      enabled: true,
      source: resolved.source,
      command: resolved.command,
      args: resolved.args,
      scopedToChangedFiles: resolved.scopedToChangedFiles,
      scope: resolved.scope,
      workingDirectory: resolved.workingDirectory,
      summary: `${toolName} -> ${resolved.display}${resolved.workingDirectory ? ` (cwd=${resolved.workingDirectory})` : ""}${resolved.scope !== "full" ? ` [scope=${resolved.scope}]` : ""}`
    });
  }

  return summaries;
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

async function resolveToolCommand({
  repoRoot,
  toolName,
  toolConfig,
  packageScripts,
  packageManager,
  changedPaths
}: {
  repoRoot: string;
  toolName: ToolExecutionName;
  toolConfig: ToolCommandConfig | undefined;
  packageScripts: Record<string, string>;
  packageManager: "pnpm" | "yarn" | "npm";
  changedPaths: string[];
}): Promise<ResolvedToolCommand | null> {
  const packageScope =
    toolName === "lint" || toolName === "test" ? await detectPackageScopeContext(repoRoot, changedPaths, packageManager) : null;

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
        usesChangedFilePlaceholder(toolConfig.args ?? []) || toolConfig.append_changed_files === true ? "changed-files" : "full"
    };
  }

  if (!toolConfig?.script) {
    const scopedAutoCommand = resolveAutoScopedToolCommand(repoRoot, toolName, packageScripts, packageManager, changedPaths, packageScope);
    if (scopedAutoCommand) {
      return scopedAutoCommand;
    }
  }

  const scriptName = resolveToolScriptName(toolName, toolConfig, packageScripts);
  if (scriptName) {
    return buildScriptCommand(toolName, scriptName, packageManager, toolConfig, changedPaths, {
      cwd: repoRoot,
      scope: toolConfig?.append_changed_files === true || usesChangedFilePlaceholder(toolConfig?.args ?? []) ? "changed-files" : "full"
    });
  }

  if (!toolConfig?.script && packageScope) {
    const packageScriptName = resolveToolScriptName(toolName, undefined, packageScope.packageScripts);
    if (packageScriptName) {
      return buildScriptCommand(toolName, packageScriptName, packageScope.packageManager, toolConfig, packageScope.relativeChangedPaths, {
        cwd: packageScope.cwd,
        scope: "package",
        workingDirectory: packageScope.workingDirectory
      });
    }
  }

  if (toolName === "typecheck") {
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
        scope: "full"
      };
    } catch {
      return null;
    }
  }

  return null;
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
        workingDirectory: options?.workingDirectory
      };
  }
}

function resolveAutoScopedToolCommand(
  repoRoot: string,
  toolName: ToolExecutionName,
  packageScripts: Record<string, string>,
  packageManager: "pnpm" | "yarn" | "npm",
  changedPaths: string[],
  packageScope: PackageScopeContext | null
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
        workingDirectory: packageScope.workingDirectory
      });
    }

    if (typeof packageScripts[candidate.script] === "string") {
      return buildScriptCommand(toolName, candidate.script, packageManager, {
        append_changed_files: candidate.appendChangedFiles
      }, changedPaths, {
        cwd: repoRoot,
        scope: candidate.appendChangedFiles ? "changed-files" : "full"
      });
    }
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
  if (Object.keys(packageScripts).length === 0) {
    return null;
  }

  return {
    cwd: packageDir,
    packageScripts,
    packageManager,
    relativeChangedPaths: changedPaths.map((changedPath) =>
      normalizePath(path.relative(packageDir, path.join(repoRoot, changedPath)))
    ),
    workingDirectory: normalizePath(path.relative(repoRoot, packageDir)) || "."
  };
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
