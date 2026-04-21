import { assertMatchesBasicSchema, extractStructuredData } from "../utils/schema.js";
import { runCommandWithRetry } from "../utils/api.js";

export class ClaudeCliProvider {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  get id() {
    return this.config.type;
  }

  async runJson({ cwd, label, systemPrompt, prompt, schema, timeoutMs, retries, baseDelayMs }) {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--permission-mode",
      "plan",
      "--tools",
      "",
      "--json-schema",
      JSON.stringify(schema)
    ];

    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    if (this.config.model) {
      args.push("--model", this.config.model);
    }

    const result = await runCommandWithRetry({
      command: this.config.command || "claude",
      args,
      cwd,
      timeoutMs,
      retries,
      baseDelayMs,
      label
    });

    const parsed = extractStructuredData(result.stdout, schema, label);
    assertMatchesBasicSchema(parsed, schema, label);
    return parsed;
  }
}
