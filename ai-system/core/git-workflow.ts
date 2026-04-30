import type { ExternalTaskRef, OrchestratorResult } from "../types.js";

export interface BranchNameProposal {
  branchName: string;
  source: string;
  reason: string;
}

/**
 * Generates a safe git branch name from task and run metadata.
 * 
 * Sanitizes spaces/symbols, includes issue/PR number when available,
 * avoids protected branch names, and handles collisions by appending
 * a short run ID.
 */
export function generateSafeBranchName(
  task: string,
  runId: string,
  externalTask?: ExternalTaskRef,
  options: { prefix?: string } = {}
): BranchNameProposal {
  const prefix = options.prefix ?? "codex/";
  let baseName: string;
  let source = "task_text";
  let reason = "Generated from task text summary.";

  if (externalTask) {
    source = "external_task";
    reason = `Generated from ${externalTask.provider} ${externalTask.kind} #${externalTask.number}.`;
    baseName = `${externalTask.kind}-${externalTask.number}`;
  } else {
    // Summarize task text: take first few words, lowercase, replace non-alphanumeric with hyphens
    baseName = task
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join("-")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // Ensure baseName is not empty
  if (!baseName) {
    baseName = "work";
  }

  // Append short run ID to avoid collisions
  const shortRunId = runId.slice(-6);
  let branchName = `${prefix}${baseName}-${shortRunId}`;

  // Avoid protected branch names (highly unlikely with prefix and suffix, but for safety)
  const protectedNames = new Set(["main", "master", "develop", "prod", "production"]);
  if (protectedNames.has(branchName)) {
    branchName = `${branchName}-branch`;
  }

  return {
    branchName,
    source,
    reason
  };
}

/**
 * Checks if the repository has uncommitted changes.
 */
export async function isRepoDirty(repoRoot: string): Promise<boolean> {
  const { runCommand } = await import("../utils/api.js");
  const result = await runCommand({
    command: "git",
    args: ["status", "--porcelain"],
    cwd: repoRoot
  });
  return result.stdout.trim().length > 0;
}

/**
 * Creates and checks out a new git branch.
 */
export async function createGitBranch(repoRoot: string, branchName: string): Promise<void> {
  const { runCommand } = await import("../utils/api.js");
  await runCommand({
    command: "git",
    args: ["checkout", "-b", branchName],
    cwd: repoRoot
  });
}

/**
 * Stages files in git.
 */
export async function stageGitFiles(repoRoot: string, filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;
  const { runCommand } = await import("../utils/api.js");
  await runCommand({
    command: "git",
    args: ["add", ...filePaths],
    cwd: repoRoot
  });
}

/**
 * Commits staged changes.
 */
export async function commitGitChanges(repoRoot: string, message: string): Promise<void> {
  const { runCommand } = await import("../utils/api.js");
  await runCommand({
    command: "git",
    args: ["commit", "-m", message],
    cwd: repoRoot
  });
}

/**
 * Generates a concise commit message from task and execution results.
 */
export function generateCommitMessage(
  task: string,
  appliedFiles: string[],
  externalTask?: ExternalTaskRef,
  options: { summary?: string; ok?: boolean } = {}
): string {
  let subject: string;
  if (externalTask) {
    subject = `${externalTask.kind}(#${externalTask.number}): ${externalTask.title || task.split("\n")[0]}`;
  } else {
    subject = `work: ${task.split("\n")[0]}`;
  }

  // Git subject line limit recommendation is 50-72 chars
  if (subject.length > 72) {
    subject = subject.slice(0, 69) + "...";
  }

  let body = `Task: ${task.trim().split("\n")[0]}\n\nApplied files:\n${appliedFiles.map((f) => `- ${f}`).join("\n")}`;

  if (options.summary) {
    body += `\n\nRun summary: ${options.summary}`;
  }

  if (options.ok === false) {
    body += "\n\nNote: This commit was generated from a run that reported some issues.";
  }

  return `${subject}\n\n${body}`;
}

/**
 * Generates a detailed PR description from task and execution results.
 */
export function generatePRDescription(
  task: string,
  appliedFiles: string[],
  runResult: OrchestratorResult,
  externalTask?: ExternalTaskRef
): string {
  const sections: string[] = [];

  // Summary section
  sections.push("## Summary");
  if (externalTask) {
    sections.push(`This PR addresses ${externalTask.kind} [${externalTask.owner}/${externalTask.repo}#${externalTask.number}](${externalTask.url}).`);
  }
  sections.push(runResult.result?.summary || `Implementation for: ${task.split("\n")[0]}`);

  // Implementation Notes
  sections.push("## Implementation Notes");
  if (runResult.plan.notes.length > 0) {
    sections.push(runResult.plan.notes.map((n) => `- ${n}`).join("\n"));
  } else {
    sections.push("- No specific implementation notes provided.");
  }

  // Files Changed
  sections.push("## Files Changed");
  sections.push(appliedFiles.map((f) => `- \`${f}\``).join("\n"));

  // Verification
  sections.push("## Verification Results");
  if (runResult.latestToolResults && runResult.latestToolResults.length > 0) {
    for (const tool of runResult.latestToolResults) {
      const icon = tool.ok ? "✅" : "❌";
      sections.push(`${icon} **${tool.name}**: ${tool.summary}`);
    }
  } else {
    sections.push("- No automated tool checks were recorded for this run.");
  }

  if (runResult.missingTests && runResult.missingTests.length > 0) {
    sections.push("\n### Missing or Planned Tests");
    for (const test of runResult.missingTests) {
      const statusIcon = test.status === "passed" ? "✅" : test.status === "failed" ? "❌" : "⏳";
      sections.push(`- [${statusIcon}] **${test.name}**: ${test.description}`);
    }
  }

  // Risks and Residual Gaps
  sections.push("## Risks and Residual Gaps");
  const riskSignals = runResult.execution?.failure ? [runResult.execution.failure.reason] : [];
  if (riskSignals.length > 0) {
    sections.push(riskSignals.map((r) => `- ${r}`).join("\n"));
  } else {
    sections.push("- No significant risks or residual gaps identified during verification.");
  }

  // Rollback Notes
  sections.push("## Rollback");
  sections.push("To rollback these changes, revert the commit or use `git revert <commit-hash>`.");

  // Artifacts
  if (runResult.artifacts?.runPath) {
    sections.push("## Artifacts");
    sections.push(`Local run artifacts preserved at: \`${runResult.artifacts.runPath}\``);
  }

  return sections.join("\n\n");
}

/**
 * Generates a PR creation preview object.
 */
export function generatePRPreview(
  branchName: string,
  task: string,
  appliedFiles: string[],
  runResult: OrchestratorResult,
  externalTask?: ExternalTaskRef
): import("../types.js").ExternalTaskUpdatePreview {
  const title = externalTask
    ? `[codex] ${externalTask.title || task.split("\n")[0]}`
    : `[codex] work: ${task.split("\n")[0]}`;

  const body = generatePRDescription(task, appliedFiles, runResult, externalTask);

  return {
    url: externalTask?.url || "local",
    action: "create_pr",
    body,
    payload: {
      title,
      head: branchName,
      base: "main", // Default base branch
      draft: true
    },
    approved: false
  };
}
