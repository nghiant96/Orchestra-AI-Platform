import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
