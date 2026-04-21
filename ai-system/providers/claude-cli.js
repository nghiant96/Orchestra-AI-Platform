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
    const effectiveTimeoutMs = this.config.timeout_ms ?? timeoutMs;
    const effectiveRetries = this.config.retries ?? retries;
    const effectiveBaseDelayMs = this.config.base_delay_ms ?? baseDelayMs;
    const effectiveMonitorIntervalMs = this.config.monitor_interval_ms ?? 0;

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
