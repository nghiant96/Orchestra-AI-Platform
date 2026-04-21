import { CodexCliProvider } from "./codex-cli.js";
import { GeminiCliProvider } from "./gemini-cli.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

export function createProvider(role, rules, logger) {
  const config = rules.providers?.[role];
  if (!config?.type) {
    throw new Error(`No provider configured for role "${role}".`);
  }

  switch (config.type) {
    case "codex-cli":
      return new CodexCliProvider({ config, logger });
    case "gemini-cli":
      return new GeminiCliProvider({ config, logger });
    case "claude-cli":
      return new ClaudeCliProvider({ config, logger });
    case "openai-compatible":
      return new OpenAICompatibleProvider({ config, logger });
    default:
      throw new Error(`Unsupported provider type "${config.type}" for role "${role}".`);
  }
}
