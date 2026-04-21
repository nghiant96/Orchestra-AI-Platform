import fs from "node:fs/promises";
import path from "node:path";
import { assertMatchesBasicSchema, extractStructuredData } from "../utils/schema.js";
import { runCommandWithRetry, withTempDir, writeJsonFile } from "../utils/api.js";

export class CodexCliProvider {
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

    return withTempDir("ai-system-codex-", async (tempDir) => {
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
      return parsed;
    });
  }
}

function buildCombinedPrompt(systemPrompt, prompt) {
  return [systemPrompt, "", prompt].filter(Boolean).join("\n\n");
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
