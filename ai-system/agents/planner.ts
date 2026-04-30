import { compilePrompt, loadPromptExamplesForTask, loadPromptTemplate } from "../utils/prompt-loader.js";
import type { AgentDependencies, JsonSchema, PlanResult } from "../types.js";

export class PlannerAgent {
  provider: AgentDependencies["provider"];
  rules: AgentDependencies["rules"];

  constructor({ provider, rules }: AgentDependencies) {
    this.provider = provider;
    this.rules = rules;
  }

  async planTask(task: string, treeString: string, cwd: string, memoryContext = ""): Promise<PlanResult> {
    const promptOptions = { repoRoot: cwd, rules: this.rules };
    const template = await loadPromptTemplate("planner", promptOptions);
    const examples = await loadPromptExamplesForTask(task, [], promptOptions);
    const systemPrompt = compilePrompt(template, {
      max_files: this.rules.max_files,
      examples
    });

    const contractInstructions = "\n\nTask Contracts:\nDefine explicit requirements that must be verified after implementation. Each contract should have an ID, description, severity, and target file paths.";
    const testPlanInstructions = "\n\nPre-Implementation Test Plan:\nDefine the testing strategy to verify the changes. Include commands to run, target test files, and the purpose of each test. Note any residual risk if a test is not practical.";

    const finalSystemPrompt = systemPrompt + contractInstructions + testPlanInstructions;

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
      systemPrompt: finalSystemPrompt,
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
    notes: { type: "array", items: { type: "string" } },
    contracts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          targetPaths: { type: "array", items: { type: "string" } }
        },
        required: ["id", "description", "severity", "targetPaths"]
      }
    },
    testPlan: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              command: { type: "string" },
              testFile: { type: "string" },
              purpose: { type: "string" },
              residualRisk: { type: "string" }
            },
            required: ["command", "purpose"]
          }
        }
      },
      required: ["items"]
    }
  },
  required: ["prompt", "readFiles", "writeTargets", "notes"]
};
