import type { OrchestratorResult } from "../types.js";
import { commitGitChanges, generateCommitMessage, generatePRDescription, stageGitFiles } from "../core/git-workflow.js";
import { runCommand } from "../utils/api.js";
import type { WorkItem } from "./work-item.js";

export interface CommitPlan {
  subject: string;
  message: string;
  filesChanged: string[];
  pushed: boolean;
}

export interface WorkItemPRPlan {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
  payload: Record<string, unknown>;
}

export function generateWorkItemCommitMessage(workItem: WorkItem, appliedFiles: string[], summary?: string): string {
  return generateCommitMessage(workItem.title, appliedFiles, workItem.externalTask, {
    summary,
    ok: true
  });
}

export function generateWorkItemPRBody(
  workItem: WorkItem,
  branchName: string,
  appliedFiles: string[],
  options: { draft?: boolean; reviewNotes?: string; base?: string } = {}
): WorkItemPRPlan {
  const runResult = buildSyntheticRunResult(workItem, appliedFiles, options.reviewNotes);
  const title = workItem.externalTask?.title ? `[codex] ${workItem.externalTask.title}` : `[codex] ${workItem.title}`;
  const body = generatePRDescription(workItem.title, appliedFiles, runResult, workItem.externalTask);
  return {
    title,
    body,
    head: branchName,
    base: options.base ?? "main",
    draft: options.draft ?? true,
    payload: {
      title,
      body,
      head: branchName,
      base: options.base ?? "main",
      draft: options.draft ?? true,
      externalTask: workItem.externalTask?.url ?? null
    }
  };
}

export async function commitWorkItemChanges(
  repoRoot: string,
  workItem: WorkItem,
  appliedFiles: string[],
  options: { push?: boolean } = {}
): Promise<CommitPlan> {
  const message = generateWorkItemCommitMessage(workItem, appliedFiles, workItem.assessment?.reason);
  await stageGitFiles(repoRoot, appliedFiles);
  await commitGitChanges(repoRoot, message);
  if (options.push) {
    await runCommand({ command: "git", args: ["push", "-u", "origin", "HEAD"], cwd: repoRoot });
  }
  return {
    subject: message.split("\n", 1)[0] ?? `work: ${workItem.title}`,
    message,
    filesChanged: [...appliedFiles],
    pushed: Boolean(options.push)
  };
}

export function previewGhPR(prPlan: WorkItemPRPlan, repoRoot: string): {
  preview: string;
  command: string;
} {
  const draftFlag = prPlan.draft ? " --draft" : "";
  const command = `gh pr create --title "${prPlan.title}" --head "${prPlan.head}" --base "${prPlan.base}"${draftFlag}`;
  return {
    preview: `Preview PR creation in ${repoRoot}`,
    command
  };
}

function buildSyntheticRunResult(workItem: WorkItem, appliedFiles: string[], reviewNotes?: string): OrchestratorResult {
  return {
    ok: true,
    result: {
      summary: reviewNotes || workItem.assessment?.reason || workItem.title
    } as any,
    plan: {
      notes: reviewNotes ? [reviewNotes] : [],
      writeTargets: appliedFiles.map((file) => ({ path: file, reason: "Applied file" }))
    } as any,
    latestToolResults: [],
    missingTests: [],
    execution: null,
    artifacts: null
  } as unknown as OrchestratorResult;
}
