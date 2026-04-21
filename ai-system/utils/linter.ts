import path from "node:path";
import fs from "node:fs/promises";
import { runCommand } from "./api.js";
import { truncate } from "./string.js";
import type { CliCommandError, GeneratedFile, Logger, ReviewIssue } from "../types.js";

export async function runStaticAnalysis(repoRoot: string, changedFiles: GeneratedFile[], logger?: Logger): Promise<ReviewIssue[]> {
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
        category: "syntax",
        path: file.path,
        description: `Invalid JSON syntax: ${normalized.message}`,
        suggestedFix: "Fix the JSON syntax before writing the file."
      });
    }
  }

  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = await readPackageJson(packageJsonPath);
  if (!packageJson) {
    return issues;
  }

  const scripts = (packageJson.scripts as Record<string, unknown> | undefined) ?? {};
  const packageManager = await detectPackageManager(repoRoot);
  const checks = await buildCheckCommands({ repoRoot, scripts, packageManager });

  for (const check of checks) {
    logger?.step(`Running static analysis: ${check.display}`);

    try {
      await runCommand({
        command: check.command,
        args: check.args,
        cwd: repoRoot,
        timeoutMs: check.timeoutMs ?? 120000
      });
    } catch (error) {
      if (looksLikeMissingExecutable(error)) {
        logger?.warn(`Static analysis skipped because ${check.command} is unavailable.`);
        continue;
      }

      issues.push({
        severity: "medium",
        category: "static-analysis",
        path: "",
        description: `Static analysis (${check.name}) failed:\n${formatCommandOutput(error)}`,
        suggestedFix: `Fix the reported ${check.name} errors before accepting the generated files.`
      });
    }
  }

  return issues;
}

async function readPackageJson(packageJsonPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

async function buildCheckCommands({
  repoRoot,
  scripts,
  packageManager
}: {
  repoRoot: string;
  scripts: Record<string, unknown>;
  packageManager: "pnpm" | "yarn" | "npm";
}): Promise<Array<{ name: string; command: string; args: string[]; display: string; timeoutMs: number }>> {
  const commands: Array<{ name: string; command: string; args: string[]; display: string; timeoutMs: number }> = [];

  if (typeof scripts.lint === "string") {
    commands.push(scriptCommand("lint", packageManager));
  }
  if (typeof scripts["type-check"] === "string") {
    commands.push(scriptCommand("type-check", packageManager));
  } else if (typeof scripts.typecheck === "string") {
    commands.push(scriptCommand("typecheck", packageManager));
  }

  const tsConfigPath = path.join(repoRoot, "tsconfig.json");
  try {
    await fs.access(tsConfigPath);
    commands.push({
      name: "tsc",
      command: "node",
      args: ["./node_modules/typescript/bin/tsc", "--noEmit", "-p", tsConfigPath],
      display: "node ./node_modules/typescript/bin/tsc --noEmit",
      timeoutMs: 120000
    });
  } catch {
    // No tsconfig.json, so skip the fallback type check.
  }

  return commands;
}

function scriptCommand(name: string, packageManager: "pnpm" | "yarn" | "npm") {
  switch (packageManager) {
    case "pnpm":
      return { name, command: "pnpm", args: ["run", name], display: `pnpm run ${name}`, timeoutMs: 120000 };
    case "yarn":
      return { name, command: "yarn", args: [name], display: `yarn ${name}`, timeoutMs: 120000 };
    case "npm":
    default:
      return { name, command: "npm", args: ["run", name], display: `npm run ${name}`, timeoutMs: 120000 };
  }
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

  return truncate(output || "Unknown static analysis failure.", 1200);
}
