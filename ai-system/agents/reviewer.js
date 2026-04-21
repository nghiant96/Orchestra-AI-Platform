export class ReviewerAgent {
  constructor({ provider, rules }) {
    this.provider = provider;
    this.rules = rules;
  }

  async reviewCode(task, originalFiles, candidateFiles, validationIssues, diffSummaries, cwd, memoryContext = "") {
    const systemPrompt = [
      "You are the review agent for a local coding system.",
      "Return JSON only.",
      "Only report concrete issues backed by the provided code.",
      "Mark bugs, correctness problems, path safety issues, and malformed JSON as high or medium.",
      "Do not mark style-only concerns as blocking.",
      "Each issue must include the exact file path and an exact code-level suggested fix.",
      "Prioritize unintended deletions and large changes outside task scope."
    ].join(" ");

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

export const REVIEW_SCHEMA = {
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
