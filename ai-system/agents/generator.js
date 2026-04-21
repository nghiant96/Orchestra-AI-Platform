export class GeneratorAgent {
  constructor({ provider, rules }) {
    this.provider = provider;
    this.rules = rules;
  }

  async generateCode(task, plan, contextFiles, cwd, memoryContext = "") {
    const systemPrompt = [
      "You are the code generation agent for a local coding system.",
      "Return JSON only.",
      "Return full replacement content for each file.",
      "Never return snippets, ellipses, or placeholders.",
      "Only write repo-relative paths.",
      "Prefer the smallest complete change that satisfies the task.",
      "When updating existing files, preserve unrelated logic and avoid removing existing functionality unless the task requires it."
    ].join(" ");

    const prompt = JSON.stringify(
      {
        task,
        plan,
        contextFiles,
        memoryContext
      },
      null,
      2
    );

    return this.provider.runJson({
      cwd,
      label: "generator output",
      systemPrompt,
      prompt,
      schema: FILE_OUTPUT_SCHEMA,
      timeoutMs: this.rules.request_timeout_ms,
      retries: this.rules.request_retries,
      baseDelayMs: this.rules.retry_base_delay_ms
    });
  }
}

export const FILE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          action: { type: "string", enum: ["create", "update"] },
          content: { type: "string" }
        },
        required: ["path", "action", "content"]
      }
    }
  },
  required: ["summary", "files"]
};
