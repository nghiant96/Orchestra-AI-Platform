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
    const effectiveTimeoutMs = this.config.timeout_ms ?? timeoutMs;
    const effectiveRetries = this.config.retries ?? retries;
    const effectiveBaseDelayMs = this.config.base_delay_ms ?? baseDelayMs;
    const effectiveMonitorIntervalMs = this.config.monitor_interval_ms ?? 0;

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
      timeoutMs: effectiveTimeoutMs,
      retries: effectiveRetries,
      baseDelayMs: effectiveBaseDelayMs,
      monitorIntervalMs: effectiveMonitorIntervalMs,
      onMonitor: buildMonitorHandler(this.logger, label, this.id),
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

function buildMonitorHandler(logger, label, providerId) {
  if (!logger?.info) {
    return undefined;
  }

  return ({ elapsedMs, monitorId }) => {
    logger.info(
      `${label} is still running via ${providerId} after ${formatDuration(elapsedMs)}${monitorId > 1 ? ` (heartbeat ${monitorId})` : ""}`
    );
  };
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}
