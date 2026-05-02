import fs from "node:fs/promises";
import path from "node:path";
import { buildBuiltinToolAdapters } from "./builtin-tool-adapters.js";
import type { RulesConfig, ToolAdapterConfig, ToolCommandConfig, ToolExecutionName } from "../types.js";
import type { ToolAdapterContext } from "./tool-scoping.js";

const DEFAULT_TOOL_TIMEOUT_MS: Record<string, number> = {
  lint: 120000,
  typecheck: 120000,
  build: 180000,
  test: 180000
};

export async function detectToolAdapterContexts(
  repoRoot: string,
  changedPaths: string[],
  tools: NonNullable<RulesConfig["tools"]>
): Promise<ToolAdapterContext[]> {
  const projectType = String(tools.project_type ?? "auto");
  const adapters = [...buildConfiguredToolAdapters(tools.adapters ?? {}), ...buildBuiltinToolAdapters(projectType, DEFAULT_TOOL_TIMEOUT_MS)];
  const contexts: ToolAdapterContext[] = [];
  for (const adapter of adapters) {
    if (adapter.enabled === false) continue;
    if (!shouldConsiderAdapter(adapter.name, projectType)) continue;
    if (!changedPathsMatchAdapter(changedPaths, adapter.changed_file_extensions ?? [])) continue;
    const workingDirectory = normalizeAdapterWorkingDirectory(adapter.working_directory);
    const cwd = path.resolve(repoRoot, workingDirectory);
    if (!isPathWithinRepo(repoRoot, cwd)) continue;
    if (!(await adapterDetected(cwd, adapter.detect_files ?? []))) continue;
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
  if (extensions.length === 0 || changedPaths.length === 0 || changedPaths.includes("{changed-file-example}")) return true;
  const normalizedExtensions = extensions.map((entry) => entry.toLowerCase());
  return changedPaths.some((changedPath) => normalizedExtensions.includes(path.extname(changedPath).toLowerCase()));
}
function normalizeAdapterWorkingDirectory(workingDirectory: unknown): string {
  if (typeof workingDirectory !== "string" || !workingDirectory.trim()) return ".";
  return workingDirectory.trim().replace(/\\/g, "/").replace(/^\.\/+/, "") || ".";
}
async function adapterDetected(cwd: string, detectFiles: string[]): Promise<boolean> {
  if (detectFiles.length === 0) return true;
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

async function resolvePythonAdapterContext(
  cwd: string,
  repoRoot: string,
  baseAdapter: ToolAdapterConfig & { name: string }
): Promise<ToolAdapterContext | null> {
  const detectFiles = ["pyproject.toml", "requirements.txt", "Pipfile", "poetry.lock", "uv.lock", "setup.py"];
  if (!(await adapterDetected(cwd, detectFiles))) return null;

  let packageManager: "uv" | "poetry" | "pipenv" | "pip" = "pip";
  if (await pathExists(path.join(cwd, "uv.lock"))) packageManager = "uv";
  else if (await pathExists(path.join(cwd, "poetry.lock"))) packageManager = "poetry";
  else if (await pathExists(path.join(cwd, "Pipfile"))) packageManager = "pipenv";

  const runPrefix =
    packageManager === "uv"
      ? ["uv", "run"]
      : packageManager === "poetry"
        ? ["poetry", "run"]
        : packageManager === "pipenv"
          ? ["pipenv", "run"]
          : ["python", "-m"];

  const commands: Partial<Record<ToolExecutionName, ToolCommandConfig>> = { ...(baseAdapter.commands ?? {}) };
  const hasRuff = (await adapterDetected(cwd, ["ruff.toml", ".ruff.toml"])) || (await checkPyprojectForTool(cwd, "ruff"));
  const hasMypy = (await adapterDetected(cwd, ["mypy.ini", ".mypy.ini"])) || (await checkPyprojectForTool(cwd, "mypy"));
  const hasPytest = (await adapterDetected(cwd, ["pytest.ini", "conftest.py"])) || (await checkPyprojectForTool(cwd, "pytest"));

  if (!commands.lint) {
    commands.lint = hasRuff
      ? { command: runPrefix[0], args: [...runPrefix.slice(1), "ruff", "check", "."] }
      : { command: runPrefix[0], args: [...runPrefix.slice(1), "flake8", "."] };
  }

  if (!commands.typecheck && hasMypy) {
    commands.typecheck = { command: runPrefix[0], args: [...runPrefix.slice(1), "mypy", "."] };
  }

  if (!commands.test) {
    commands.test = hasPytest
      ? { command: runPrefix[0], args: [...runPrefix.slice(1), "pytest"] }
      : { command: runPrefix[0], args: [...runPrefix.slice(1), "unittest", "discover"] };
  }

  return {
    name: "python",
    cwd,
    workingDirectory: path.relative(repoRoot, cwd).replace(/\\/g, "/") || ".",
    commands,
    changedFileExtensions: [".py"]
  };
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function checkPyprojectForTool(cwd: string, toolName: string): Promise<boolean> {
  try {
    const content = await fs.readFile(path.join(cwd, "pyproject.toml"), "utf8");
    return content.includes(`[tool.${toolName}]`);
  } catch {
    return false;
  }
}
