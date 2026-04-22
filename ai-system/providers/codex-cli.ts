import fs from "node:fs/promises";
import path from "node:path";
import { assertMatchesBasicSchema, extractStructuredData } from "../utils/schema.js";
import { runCommandWithRetry, withTempDir, writeJsonFile } from "../utils/api.js";
import type { CommandMonitorEvent, JsonProvider, Logger, ProviderConfig, RunJsonOptions } from "../types.js";

export class CodexCliProvider implements JsonProvider {
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

    return withTempDir("ai-system-codex-", async (tempDir: string) => {
      const schemaPath = path.join(tempDir, "schema.json");
      const outputPath = path.join(tempDir, "output.json");
      await writeJsonFile(schemaPath, schema);

      const args = [
        "exec",
        "-C",
        cwd,
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-schema",
        schemaPath,
        "-o",
        outputPath
      ];

      if (this.config.model) {
        args.push("--model", this.config.model);
      }

      args.push(buildCombinedPrompt(systemPrompt, prompt));

      await runCommandWithRetry({
        command: this.config.command || "codex",
        args,
        cwd,
        timeoutMs: effectiveTimeoutMs,
        retries: effectiveRetries,
        baseDelayMs: effectiveBaseDelayMs,
        monitorIntervalMs: effectiveMonitorIntervalMs,
        onMonitor: buildMonitorHandler(this.logger, label, this.id),
        label
      });

      const raw = await fs.readFile(outputPath, "utf8");
      const parsed = extractStructuredData(raw, schema, label);
      assertMatchesBasicSchema(parsed, schema, label);
      return parsed as T;
    });
  }
}

function buildCombinedPrompt(systemPrompt: string, prompt: string): string {
  return [systemPrompt, "", prompt].filter(Boolean).join("\n\n");
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
