import { compilePrompt, loadPromptTemplate } from "../utils/prompt-loader.js";
import { summarizeRules } from "../utils/config.js";
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
      rules_summary: summarizeRules(this.rules)
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

    const rawResult = await this.provider.runJson({
      cwd,
      label: "generator output",
      systemPrompt,
      prompt,
      schema: FILE_OUTPUT_SCHEMA,
      timeoutMs: this.rules.request_timeout_ms,
      retries: this.rules.request_retries,
      baseDelayMs: this.rules.retry_base_delay_ms
    }) as FileGenerationResult;

    return this.validateOutput(rawResult, plan, contextFiles);
  }

  private validateOutput(
    result: FileGenerationResult,
    plan: PlanResult,
    contextFiles: ContextFile[]
  ): FileGenerationResult {
    const allowedPaths = new Set([
      ...plan.readFiles,
      ...plan.writeTargets,
      ...contextFiles.map((f) => f.path)
    ]);

    // Only keep files that are somewhat relevant to the plan's scope
    const filteredFiles = result.files.filter((file) => {
      if (allowedPaths.has(file.path)) return true;
      // If it's a new file, it should ideally be in writeTargets
      if (file.action === "create" && plan.writeTargets.includes(file.path)) return true;
      return false;
    });

    return {
      ...result,
      files: filteredFiles
    };
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
