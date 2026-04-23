import { compilePrompt, loadPromptTemplate } from "../utils/prompt-loader.js";
import type { AgentDependencies, ContextFile, FileGenerationResult, JsonSchema, PlanResult } from "../types.js";

export class GeneratorAgent {
  provider: AgentDependencies["provider"];
  rules: AgentDependencies["rules"];

  constructor({ provider, rules }: AgentDependencies) {
    this.provider = provider;
    this.rules = rules;
  }

  async generateCode(
    task: string,
    plan: PlanResult,
    contextFiles: ContextFile[],
    cwd: string,
    memoryContext = ""
  ): Promise<FileGenerationResult> {
    const template = await loadPromptTemplate("generator");
    const systemPrompt = compilePrompt(template, {
      rules_summary: "" // TODO: Add project rules summary if needed
    });

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

export const FILE_OUTPUT_SCHEMA: JsonSchema = {
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
