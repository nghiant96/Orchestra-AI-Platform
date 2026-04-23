import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvironment } from "../utils/api.js";
import { runToolChecks } from "./tool-executor.js";
import { summarizeIssueCounts } from "./reviewer.js";
import { loadOrchestratorRuntime } from "./orchestrator-runtime.js";
import type { Logger, ToolExecutionResult } from "../types.js";

export interface FixChecksPreparation {
  repoRoot: string;
  configPath: string | null;
  task: string;
  providers: {
    planner: string;
    reviewer: string;
    generator: string;
    fixer: string;
  };
  latestToolResults: ToolExecutionResult[];
  issueCounts: Record<"high" | "medium" | "low", number>;
  failingChecks: ToolExecutionResult[];
  fileHints: string[];
}

export async function prepareFixChecksTask({
  repoRoot,
  configPath,
  providerPreset,
  logger
}: {
  repoRoot: string;
  configPath: string | null;
  providerPreset: string | null;
  logger: Logger;
}): Promise<FixChecksPreparation | null> {
  const resolvedRepoRoot = await fs.realpath(repoRoot);
  await loadEnvironment(resolvedRepoRoot);

  const { configPath: loadedConfigPath, runtime } = await loadOrchestratorRuntime({
    repoRoot: resolvedRepoRoot,
    explicitConfigPath: configPath,
    logger,
    task: "Fix the currently failing repository checks."
  });

  if (providerPreset) {
    logger.info(`fix-checks workflow using provider preset ${providerPreset}.`);
  }

  const toolExecution = await runToolChecks({
    repoRoot: resolvedRepoRoot,
    changedFiles: [],
    rules: runtime.reviewer.rules,
    logger
  });
  const failingChecks = toolExecution.results.filter((result) => !result.skipped && !result.ok);
  if (failingChecks.length === 0 && toolExecution.issues.length === 0) {
    return null;
  }

  const fileHints = await extractExistingFileHints(
    resolvedRepoRoot,
    failingChecks.flatMap((result) => [
      result.stdout ?? "",
      result.stderr ?? "",
      result.summary ?? "",
      result.command ?? "",
      ...(result.args ?? [])
    ])
  );

  return {
    repoRoot: resolvedRepoRoot,
    configPath: loadedConfigPath,
    task: buildFixChecksTask(failingChecks, fileHints),
    providers: runtime.providerSummary,
    latestToolResults: toolExecution.results,
    issueCounts: summarizeIssueCounts(toolExecution.issues),
    failingChecks,
    fileHints
  };
}

export function buildFixChecksTask(failingChecks: ToolExecutionResult[], fileHints: string[]): string {
  const lines = [
    "Fix the currently failing repository checks.",
    "Goal: update the code so the failing checks pass while preserving existing behavior.",
    "",
    "Failing checks:"
  ];

  for (const result of failingChecks) {
    lines.push(`- ${result.name}: ${result.summary}`);
    if (result.command) {
      lines.push(`  command: ${result.command}${result.args && result.args.length > 0 ? ` ${result.args.join(" ")}` : ""}`);
    }
    const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    if (output) {
      lines.push(`  output: ${truncateForTask(output, 500)}`);
    }
  }

  if (fileHints.length > 0) {
    lines.push("");
    lines.push(`Likely related files: ${fileHints.join(", ")}`);
  }

  lines.push("");
  lines.push("Prefer the smallest safe code change that makes the checks pass.");
  lines.push("Re-run checks and fix any remaining blocking issues before finishing.");
  return lines.join("\n");
}

async function extractExistingFileHints(repoRoot: string, snippets: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const hints: string[] = [];
  const pattern = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|yml|yaml|md))/g;

  for (const snippet of snippets) {
    for (const match of snippet.matchAll(pattern)) {
      const candidate = normalizeCandidatePath(match[1] ?? "");
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      const absolute = path.join(repoRoot, candidate);
      try {
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) {
          continue;
        }
        seen.add(candidate);
        hints.push(candidate);
      } catch {
        continue;
      }
    }
  }

  return hints.slice(0, 8);
}

function normalizeCandidatePath(value: string): string | null {
  const trimmed = value.trim().replace(/^\.\/+/, "").replace(/[):,;]+$/, "");
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("../") || trimmed.includes("..\\") || trimmed.includes("\0")) {
    return null;
  }
  return trimmed.replace(/\\/g, "/");
}

function truncateForTask(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}
