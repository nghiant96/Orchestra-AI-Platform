import { compilePrompt, loadPromptTemplate } from "../utils/prompt-loader.js";
import type { AgentDependencies, JsonSchema, PlanResult } from "../types.js";

export class PlannerAgent {
  provider: AgentDependencies["provider"];
  rules: AgentDependencies["rules"];

  constructor({ provider, rules }: AgentDependencies) {
    this.provider = provider;
    this.rules = rules;
  }

  async planTask(task: string, treeString: string, cwd: string, memoryContext = ""): Promise<PlanResult> {
    const template = await loadPromptTemplate("planner");
    const systemPrompt = compilePrompt(template, {
      max_files: this.rules.max_files
    });

    const prompt = [
      `Task: ${task}`,
      memoryContext ? `\n${memoryContext}` : "",
      "",
      "Repository tree:",
      treeString,
      "",
      "Return planner JSON."
    ].join("\n");

    return this.provider.runJson({
      cwd,
      label: "planner output",
      systemPrompt,
      prompt,
      schema: PLAN_SCHEMA,
      timeoutMs: this.rules.request_timeout_ms,
      retries: this.rules.request_retries,
      baseDelayMs: this.rules.retry_base_delay_ms
    });
  }
}

export const PLAN_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: { type: "string" },
    readFiles: { type: "array", items: { type: "string" } },
    writeTargets: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } }
  },
  required: ["prompt", "readFiles", "writeTargets", "notes"]
};
