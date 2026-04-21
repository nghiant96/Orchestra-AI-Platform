import type { AgentDependencies, JsonSchema, PlanResult } from "../types.js";

export class PlannerAgent {
  provider: AgentDependencies["provider"];
  rules: AgentDependencies["rules"];

  constructor({ provider, rules }: AgentDependencies) {
    this.provider = provider;
    this.rules = rules;
  }

  async planTask(task: string, treeString: string, cwd: string, memoryContext = ""): Promise<PlanResult> {
    const systemPrompt = [
      "You are the planning agent for a local coding system.",
      "Return JSON only.",
      "Pick the minimum safe context needed to complete the task.",
      `Select at most ${this.rules.max_files} existing files to read.`,
      "Use only repo-relative paths.",
      "Never request .env, secrets, keys, certificates, or files outside the repo.",
      "Keep the implementation prompt concise and concrete."
    ].join(" ");

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
