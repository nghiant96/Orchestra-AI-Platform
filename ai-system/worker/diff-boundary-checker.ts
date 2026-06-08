import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/api.js";
import type { WorkerContextPack } from "./context-pack.js";

export interface DiffBoundaryCheckInput {
  changedFiles: string[];
  contextPack: WorkerContextPack | null;
  repoRoot: string;
  worktreePath: string;
}

export interface DiffBoundaryFinding {
  code:
    | "BOUNDARY_OUTSIDE_ALLOWED"
    | "NEW_FILE_NOT_DECLARED"
    | "TOUCHED_DO_NOT_TOUCH"
    | "LOW_CONFIDENCE_CONTEXT";
  severity: "error" | "warning" | "info";
  filePath?: string;
  message: string;
}

export interface DiffBoundaryCheckResult {
  ok: boolean;
  mode: "off" | "warn" | "strict";
  newFilePolicy: "allow" | "warn" | "strict";
  findings: DiffBoundaryFinding[];
}

export async function runDiffBoundaryCheck(input: DiffBoundaryCheckInput): Promise<DiffBoundaryCheckResult> {
  const mode = normalizeMode(process.env.ORCHESTRA_DIFF_BOUNDARY_MODE);
  const newFilePolicy = normalizeNewFilePolicy(process.env.ORCHESTRA_NEW_FILE_POLICY);
  if (mode === "off") {
    return { ok: true, mode, newFilePolicy, findings: [] };
  }

  const findings: DiffBoundaryFinding[] = [];
  if (!input.contextPack || input.contextPack.confidence === "low") {
    findings.push({
      code: "LOW_CONFIDENCE_CONTEXT",
      severity: "warning",
      message: input.contextPack
        ? "Context pack confidence is low; boundary findings may be incomplete."
        : "Context pack is unavailable; boundary enforcement is limited."
    });
  }

  const changedFiles = normalizePaths(input.changedFiles);
  const doNotTouch = normalizePatterns(input.contextPack?.doNotTouch ?? []);
  const allowedBoundary = normalizePatterns(input.contextPack?.allowedDiffBoundary ?? []);
  const proposedFiles = new Set(
    normalizePaths((input.contextPack?.relevantFiles ?? [])
      .filter((file) => file.status === "proposed")
      .map((file) => file.path))
  );

  for (const filePath of changedFiles) {
    if (matchesAnyPattern(filePath, doNotTouch)) {
      findings.push({
        code: "TOUCHED_DO_NOT_TOUCH",
        severity: "error",
        filePath,
        message: `${filePath} matches the context pack doNotTouch boundary.`
      });
      continue;
    }

    if (allowedBoundary.length > 0 && !matchesAnyPattern(filePath, allowedBoundary)) {
      findings.push({
        code: "BOUNDARY_OUTSIDE_ALLOWED",
        severity: mode === "strict" ? "error" : "warning",
        filePath,
        message: `${filePath} is outside the context pack allowedDiffBoundary.`
      });
    }
  }

  if (newFilePolicy !== "allow") {
    const newFiles = await collectNewFiles(input.worktreePath);
    for (const filePath of newFiles) {
      if (!proposedFiles.has(filePath)) {
        findings.push({
          code: "NEW_FILE_NOT_DECLARED",
          severity: newFilePolicy === "strict" ? "error" : "warning",
          filePath,
          message: `${filePath} is a new file but was not declared as proposed in the context pack.`
        });
      }
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    mode,
    newFilePolicy,
    findings
  };
}

export async function writeDiffBoundaryCheckArtifact(
  artifactDir: string,
  result: DiffBoundaryCheckResult
): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "diff-boundary-check.json"),
    `${JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      ...result
    }, null, 2)}\n`,
    "utf8"
  );
}

function normalizeMode(value: string | undefined): DiffBoundaryCheckResult["mode"] {
  return value === "off" || value === "strict" || value === "warn" ? value : "warn";
}

function normalizeNewFilePolicy(value: string | undefined): DiffBoundaryCheckResult["newFilePolicy"] {
  return value === "allow" || value === "strict" || value === "warn" ? value : "warn";
}

async function collectNewFiles(worktreePath: string): Promise<string[]> {
  try {
    const result = await runCommand({
      command: "git",
      args: ["status", "--porcelain", "--untracked-files=all"],
      cwd: worktreePath,
      timeoutMs: 30000
    });
    return normalizePaths(result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => line.startsWith("?? ") || line.slice(0, 2).includes("A"))
      .map((line) => line.slice(3).trim())
      .map((line) => line.includes(" -> ") ? line.split(" -> ").pop() || line : line));
  } catch {
    return [];
  }
}

function normalizePatterns(patterns: string[]): string[] {
  return normalizePaths(patterns).map((pattern) => pattern.replace(/\/+$/, ""));
}

function normalizePaths(paths: string[]): string[] {
  return [...new Set(paths
    .map((filePath) => filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim())
    .filter(Boolean))]
    .sort();
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

function matchesPattern(filePath: string, pattern: string): boolean {
  if (pattern === filePath) return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    const rest = filePath.startsWith(`${prefix}/`) ? filePath.slice(prefix.length + 1) : "";
    return Boolean(rest) && !rest.includes("/");
  }
  if (pattern.includes("*")) {
    return globToRegex(pattern).test(filePath);
  }
  return filePath.startsWith(`${pattern}/`);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("")
    .map((char) => {
      if (char === "*") return "[^/]*";
      return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
    })
    .join("");
  return new RegExp(`^${escaped}$`);
}
