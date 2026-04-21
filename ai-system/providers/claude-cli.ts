import { assertMatchesBasicSchema, extractStructuredData } from "../utils/schema.js";
import { runCommandWithRetry } from "../utils/api.js";
import type { CommandMonitorEvent, JsonProvider, Logger, ProviderConfig, RunJsonOptions } from "../types.js";

export class ClaudeCliProvider implements JsonProvider {
  config: ProviderConfig;
  logger?: Logger;

  constructor({ config, logger }: { config: ProviderConfig; logger?: Logger }) {
    this.config = config;
    this.logger = logger;
  }

  get id() {
    return this.config.type;
  }

  async runJson<T = unknown>({
    cwd,
    label,
    systemPrompt,
    prompt,
    schema,
    timeoutMs,
    retries,
    baseDelayMs
  }: RunJsonOptions): Promise<T> {
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
    return parsed as T;
  }
}

function buildMonitorHandler(logger: Logger | undefined, label: string, providerId: string) {
  if (!logger?.info) {
    return undefined;
  }

  return ({ elapsedMs, monitorId }: CommandMonitorEvent) => {
    logger.info(
      `${label} is still running via ${providerId} after ${formatDuration(elapsedMs)}${monitorId > 1 ? ` (heartbeat ${monitorId})` : ""}`
    );
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}
