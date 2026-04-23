import { compilePrompt, loadPromptTemplate } from "../utils/prompt-loader.js";
import type {
  AgentDependencies,
  ContextFile,
  DiffSummary,
  GeneratedFile,
  JsonSchema,
  ReviewIssue,
  ReviewResult
} from "../types.js";

export class ReviewerAgent {
  provider: AgentDependencies["provider"];
  rules: AgentDependencies["rules"];

  constructor({ provider, rules }: AgentDependencies) {
    this.provider = provider;
    this.rules = rules;
  }

  async reviewCode(
    task: string,
    originalFiles: Array<{ path: string; content?: string | null }>,
    candidateFiles: GeneratedFile[],
    validationIssues: ReviewIssue[],
    diffSummaries: DiffSummary[],
    cwd: string,
    memoryContext = ""
  ): Promise<ReviewResult> {
    const template = await loadPromptTemplate("reviewer");
    const systemPrompt = compilePrompt(template, {});

    const prompt = JSON.stringify(
      {
        task,
        originalFiles,
        candidateFiles,
        validationIssues,
        diffSummaries,
        memoryContext
      },
      null,
      2
    );

    return this.provider.runJson({
      cwd,
      label: "reviewer output",
      systemPrompt,
      prompt,
      schema: REVIEW_SCHEMA,
      timeoutMs: this.rules.request_timeout_ms,
      retries: this.rules.request_retries,
      baseDelayMs: this.rules.retry_base_delay_ms
    });
  }
}

export const REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string" },
          path: { type: "string" },
          description: { type: "string" },
          suggestedFix: { type: "string" }
        },
        required: ["severity", "category", "path", "description", "suggestedFix"]
      }
    }
  },
  required: ["summary", "issues"]
};
