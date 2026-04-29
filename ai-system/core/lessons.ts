import fs from "node:fs/promises";
import path from "node:path";
import type { RecentRunSummary } from "./artifacts.js";

export interface ProjectLesson {
  title: string;
  body: string;
}

export async function readProjectLessons(repoRoot: string, limit = 10): Promise<ProjectLesson[]> {
  const lessonsPath = resolveLessonsPath(repoRoot);
  try {
    const raw = await fs.readFile(lessonsPath, "utf8");
    return parseLessons(raw).slice(0, limit);
  } catch {
    return [];
  }
}

export async function appendProjectLesson(repoRoot: string, lesson: ProjectLesson): Promise<void> {
  const lessonsPath = resolveLessonsPath(repoRoot);
  await fs.mkdir(path.dirname(lessonsPath), { recursive: true });
  const entry = [
    "",
    `## ${new Date().toISOString().slice(0, 10)}: ${lesson.title}`,
    "",
    lesson.body.trim(),
    ""
  ].join("\n");
  await fs.appendFile(lessonsPath, entry, "utf8");
}

export function formatLessonsForPrompt(lessons: ProjectLesson[]): string {
  if (lessons.length === 0) {
    return "";
  }
  return [
    "Project lessons to respect:",
    ...lessons.map((lesson) => `- ${lesson.title}: ${lesson.body.replace(/\s+/g, " ").trim()}`)
  ].join("\n");
}

export function proposeLessonsFromRuns(runs: RecentRunSummary[]): ProjectLesson[] {
  const failuresByClass = new Map<string, number>();
  for (const run of runs) {
    const failureClass = run.runState.execution?.failure?.class;
    if (run.runState.status === "failed" && failureClass) {
      failuresByClass.set(failureClass, (failuresByClass.get(failureClass) ?? 0) + 1);
    }
  }

  return [...failuresByClass.entries()]
    .filter(([, count]) => count >= 2)
    .map(([failureClass, count]) => ({
      title: `Repeated ${failureClass.replace(/_/g, " ")} failures`,
      body: `Detected ${count} recent failed runs with failure class "${failureClass}". Add a focused check or Task Contract before future runs in this area.`
    }));
}

function parseLessons(raw: string): ProjectLesson[] {
  const sections = raw.split(/^##\s+/m).slice(1);
  return sections.map((section) => {
    const [titleLine = "Untitled", ...bodyLines] = section.trim().split("\n");
    return {
      title: titleLine.replace(/^\d{4}-\d{2}-\d{2}:\s*/, "").trim(),
      body: bodyLines.join("\n").trim()
    };
  }).filter((lesson) => lesson.title && lesson.body);
}

function resolveLessonsPath(repoRoot: string): string {
  return path.join(repoRoot, "tasks", "lessons.md");
}
