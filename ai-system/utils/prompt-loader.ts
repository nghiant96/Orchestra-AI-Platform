import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type PromptExampleTaskType = "bug-fix" | "refactor" | "new-feature" | "review";

export async function loadPromptTemplate(name: string): Promise<string> {
  const promptPath = path.join(__dirname, "..", "prompts", `${name}.md`);
  try {
    return await fs.readFile(promptPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to load prompt template "${name}" from ${promptPath}: ${(error as Error).message}`, { cause: error });
  }
}

export function compilePrompt(template: string, variables: Record<string, string | number>): string {
  let compiled = template;
  for (const [key, value] of Object.entries(variables)) {
    compiled = compiled.replaceAll(`{{${key}}}`, String(value));
  }
  return compiled.trim();
}

export async function loadPromptExamplesForTask(task: string, paths: string[] = []): Promise<string> {
  const taskType = inferPromptExampleType(task, paths);
  const examplePath = path.join(__dirname, "..", "prompts", "examples", `${taskType}.md`);
  try {
    return await fs.readFile(examplePath, "utf8");
  } catch {
    return "";
  }
}

export function inferPromptExampleType(task: string, paths: string[] = []): PromptExampleTaskType {
  const haystack = `${task} ${paths.join(" ")}`.toLowerCase();
  if (/\b(review|audit|inspect|code review|pr)\b/.test(haystack)) {
    return "review";
  }
  if (/\b(refactor|rename|restructure|simplify|cleanup|clean up|extract)\b/.test(haystack)) {
    return "refactor";
  }
  if (/\b(add|create|new feature|implement|build|support)\b/.test(haystack)) {
    return "new-feature";
  }
  return "bug-fix";
}
