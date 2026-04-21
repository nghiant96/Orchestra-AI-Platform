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
    const systemPrompt = [
      "You are the code fix agent for a local coding system.",
      "Return JSON only.",
      "Fix the reported blocking issues in the provided files.",
      "Return full replacement content for every changed file.",
      "Do not invent extra files unless strictly required to resolve the issues.",
      "Preserve unrelated logic while fixing the reported problems."
    ].join(" ");

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
