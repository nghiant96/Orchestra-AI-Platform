import fs from "node:fs/promises";
import path from "node:path";
import type { QueueJob } from "../core/job-queue.js";
import type { RulesConfig } from "../types.js";
import { redactObject, redactSecrets } from "../security/secret-redaction.js";
import type { WorkItem } from "./work-item.js";

export interface WorkItemLesson {
  schemaVersion: 1;
  workItemId: string;
  status: WorkItem["status"];
  lessonType: "success" | "failure" | "in-progress";
  title: string;
  summary: string;
  changedFiles: string[];
  commands: Array<{
    name: string;
    command?: string;
    ok: boolean;
    summary?: string;
  }>;
  evidence: Array<{
    type: string;
    ref: string;
    metadata?: Record<string, unknown>;
  }>;
  linkedRuns: string[];
  failure?: {
    class?: string;
    message: string;
    suggestion?: string;
  };
  createdAt: string;
}

export async function generateAndPersistWorkItemLesson(
  repoRoot: string,
  rules: RulesConfig,
  workItem: WorkItem,
  jobs: QueueJob[]
): Promise<{ lesson: WorkItemLesson; lessonPath: string; summaryPath: string }> {
  const lesson = redactLesson(generateWorkItemLesson(workItem, jobs));
  const lessonDir = resolveLessonDir(repoRoot, rules, workItem.id);
  await fs.mkdir(lessonDir, { recursive: true });
  const lessonPath = path.join(lessonDir, "lesson.json");
  const summaryPath = path.join(lessonDir, "summary.md");
  await fs.writeFile(lessonPath, `${JSON.stringify(lesson, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, renderLessonSummary(lesson), "utf8");
  return { lesson, lessonPath, summaryPath };
}

export async function loadWorkItemLesson(
  repoRoot: string,
  rules: RulesConfig,
  workItemId: string
): Promise<{ lesson: WorkItemLesson; lessonPath: string; summaryPath: string } | null> {
  const lessonDir = resolveLessonDir(repoRoot, rules, workItemId);
  const lessonPath = path.join(lessonDir, "lesson.json");
  const summaryPath = path.join(lessonDir, "summary.md");
  try {
    return {
      lesson: JSON.parse(await fs.readFile(lessonPath, "utf8")) as WorkItemLesson,
      lessonPath,
      summaryPath
    };
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export function generateWorkItemLesson(workItem: WorkItem, jobs: QueueJob[]): WorkItemLesson {
  const changedFiles = unique(jobs.flatMap((job) => job.diffSummaries?.map((diff) => diff.path) ?? []));
  const commands = jobs.flatMap((job) =>
    job.latestToolResults?.map((tool) => ({
      name: String(tool.name),
      command: tool.command,
      ok: Boolean(tool.ok),
      summary: tool.summary
    })) ?? []
  );
  const failedJob = jobs.find((job) => job.status === "failed" || job.error);
  const lessonType: WorkItemLesson["lessonType"] =
    workItem.status === "failed" || failedJob ? "failure" : workItem.status === "done" ? "success" : "in-progress";
  const evidence = [
    ...jobs.flatMap((job) => [
      job.artifactPath ? { type: "artifact", ref: job.artifactPath, metadata: { jobId: job.jobId } } : null,
      job.resultSummary ? { type: "run", ref: job.jobId, metadata: { status: job.status, summary: job.resultSummary } } : null
    ].filter(Boolean) as WorkItemLesson["evidence"]),
    ...(workItem.checklist ?? [])
      .filter((item) => item.evidence)
      .map((item) => ({
        type: item.evidence!.type,
        ref: item.evidence!.ref,
        metadata: {
          checklistId: item.id,
          text: item.text,
          status: item.status,
          ...item.evidence!.metadata
        }
      }))
  ];

  return {
    schemaVersion: 1,
    workItemId: workItem.id,
    status: workItem.status,
    lessonType,
    title: workItem.title,
    summary: summarizeLesson(workItem, jobs, changedFiles, commands, lessonType),
    changedFiles,
    commands,
    evidence,
    linkedRuns: workItem.linkedRuns,
    failure: failedJob
      ? {
          class: failedJob.failure?.class,
          message: failedJob.error || failedJob.failure?.message || "Work item failed.",
          suggestion: failedJob.failure?.suggestion
        }
      : undefined,
    createdAt: new Date().toISOString()
  };
}

function summarizeLesson(
  workItem: WorkItem,
  jobs: QueueJob[],
  changedFiles: string[],
  commands: WorkItemLesson["commands"],
  lessonType: WorkItemLesson["lessonType"]
): string {
  const jobSummary = jobs.map((job) => job.resultSummary || job.error).filter(Boolean).join(" ");
  const commandSummary = commands.length > 0
    ? `${commands.filter((cmd) => cmd.ok).length}/${commands.length} verification command(s) passed.`
    : "No verification command was recorded.";
  const fileSummary = changedFiles.length > 0
    ? `${changedFiles.length} changed file(s): ${changedFiles.slice(0, 8).join(", ")}.`
    : "No changed files were recorded.";
  return [
    `${lessonType === "failure" ? "Failure lesson" : lessonType === "success" ? "Success lesson" : "In-progress lesson"} for ${workItem.title}.`,
    workItem.description ? `Task context: ${workItem.description}` : "",
    jobSummary,
    fileSummary,
    commandSummary
  ].filter(Boolean).join(" ");
}

function renderLessonSummary(lesson: WorkItemLesson): string {
  return [
    `# Lesson: ${lesson.title}`,
    "",
    `- Work item: ${lesson.workItemId}`,
    `- Status: ${lesson.status}`,
    `- Type: ${lesson.lessonType}`,
    "",
    "## Summary",
    "",
    lesson.summary,
    "",
    "## Changed Files",
    "",
    lesson.changedFiles.length ? lesson.changedFiles.map((file) => `- ${file}`).join("\n") : "- None recorded",
    "",
    "## Commands",
    "",
    lesson.commands.length
      ? lesson.commands.map((cmd) => `- ${cmd.ok ? "passed" : "failed"} ${cmd.name}${cmd.command ? `: ${cmd.command}` : ""}`).join("\n")
      : "- None recorded",
    ""
  ].join("\n");
}

function redactLesson(lesson: WorkItemLesson): WorkItemLesson {
  return redactObject(lesson as unknown as Record<string, unknown>) as unknown as WorkItemLesson;
}

function resolveLessonDir(repoRoot: string, rules: RulesConfig, workItemId: string): string {
  if (!/^work-[A-Za-z0-9][A-Za-z0-9-]{0,160}$/.test(workItemId)) {
    throw new Error(`Invalid work item id: ${workItemId}`);
  }
  return path.join(repoRoot, rules.artifacts?.data_dir || ".ai-system-artifacts", "work-items", workItemId, "lesson");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(redactSecrets))];
}
