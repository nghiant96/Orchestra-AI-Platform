import { compilePrompt, loadPromptExamplesForTask, loadPromptTemplate } from "../utils/prompt-loader.js";
import { FILE_OUTPUT_SCHEMA } from "./generator.js";
import type { AgentDependencies, FileGenerationResult, PlanResult, ReviewIssue } from "../types.js";

export class FixerAgent {
  provider: AgentDependencies["provider"];
  rules: AgentDependencies["rules"];

  constructor({ provider, rules }: AgentDependencies) {
    this.provider = provider;
    this.rules = rules;
  }

  async fixCode(
    task: string,
    plan: PlanResult,
    currentFiles: FileGenerationResult["files"],
    reviewSummary: string,
    issues: ReviewIssue[],
    cwd: string,
    memoryContext = ""
  ): Promise<FileGenerationResult> {
    const promptOptions = { repoRoot: cwd, rules: this.rules };
    const template = await loadPromptTemplate("fixer", promptOptions);
    const examples = await loadPromptExamplesForTask(task, [
      ...plan.readFiles,
      ...plan.writeTargets,
      ...currentFiles.map((file) => file.path),
      ...issues.map((issue) => issue.path)
    ], promptOptions);
    const systemPrompt = compilePrompt(template, { examples });

    const prompt = JSON.stringify(
      {
        task,
        plan,
        currentFiles,
        reviewSummary,
        issues,
        memoryContext
      },
      null,
      2
    );

    return this.provider.runJson({
      cwd,
      label: "fixer output",
      systemPrompt,
      prompt,
      schema: FILE_OUTPUT_SCHEMA,
      timeoutMs: this.rules.request_timeout_ms,
      retries: this.rules.request_retries,
      baseDelayMs: this.rules.retry_base_delay_ms
    });
  }
}
