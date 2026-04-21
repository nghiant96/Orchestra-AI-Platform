import { assertMatchesBasicSchema, extractStructuredData } from "../utils/schema.js";
import { runCommandWithRetry } from "../utils/api.js";

export class GeminiCliProvider {
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
      buildCombinedPrompt(systemPrompt, prompt, schema),
      "--approval-mode",
      "plan",
      "--output-format",
      "json"
    ];

    if (this.config.model) {
      args.push("--model", this.config.model);
    }

    const result = await runCommandWithRetry({
      command: this.config.command || "gemini",
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

function buildCombinedPrompt(systemPrompt, prompt, schema) {
  return [
    systemPrompt,
    "",
    "All model outputs must be valid JSON with no markdown, code fences, or extra text.",
    "Return exactly one JSON object matching this schema.",
    JSON.stringify(schema, null, 2),
    "",
    "Do not rename keys. Do not add wrapper objects. Do not add commentary.",
    prompt
  ]
    .filter(Boolean)
    .join("\n\n");
}
