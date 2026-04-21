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
        timeoutMs,
        retries,
        baseDelayMs,
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
