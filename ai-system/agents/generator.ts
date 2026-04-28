import { compilePrompt, loadPromptExamplesForTask, loadPromptTemplate } from "../utils/prompt-loader.js";
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
    const examples = await loadPromptExamplesForTask(task, [
      ...plan.readFiles,
      ...plan.writeTargets,
      ...contextFiles.map((file) => file.path)
    ]);
    const systemPrompt = compilePrompt(template, {
      rules_summary: summarizeRules(this.rules),
      examples
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

    const filteredFiles = result.files.filter((file) => {
      if (allowedPaths.has(file.path)) return true;
      if (file.action === "create" && plan.writeTargets.includes(file.path)) return true;
      return false;
    });

    if (result.files.length > 0 && filteredFiles.length === 0) {
      const returnedPaths = result.files.map((file) => file.path).join(", ");
      const allowedPathList = [...allowedPaths].join(", ");
      throw new Error(
        `Generator returned files outside the planned scope (${returnedPaths}). Allowed paths: ${allowedPathList || "none"}.`
      );
    }

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
