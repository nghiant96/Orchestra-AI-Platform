import { CodexCliProvider } from "./codex-cli.js";
import { GeminiCliProvider } from "./gemini-cli.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { estimateTokenCount } from "../utils/string.js";
import type { JsonProvider, Logger, RulesConfig, ProviderUsageMetric, ProviderRole, RunJsonOptions } from "../types.js";
import { PROVIDER_TOKEN_COST_UNITS } from "../types.js";

export class UsageTrackingProvider implements JsonProvider {
  private base: JsonProvider;
  private role: ProviderRole;
  private metrics: ProviderUsageMetric[] = [];

  constructor(base: JsonProvider, role: ProviderRole) {
    this.base = base;
    this.role = role;
  }

  get id() {
    return this.base.id;
  }

  async runJson<T = unknown>(options: RunJsonOptions): Promise<T> {
    const promptTokens = estimateTokenCount(options.systemPrompt || "") + estimateTokenCount(options.prompt || "");
    const result = await this.base.runJson<T>(options);
    const completionTokens = estimateTokenCount(JSON.stringify(result));
    const totalTokens = promptTokens + completionTokens;

    // Default to a generic cost if specific provider unit not found
    const costPer1k = PROVIDER_TOKEN_COST_UNITS[this.id] ?? 0.02;
    const estimatedCostUnits = (totalTokens / 1000) * costPer1k;

    this.metrics.push({
      role: this.role,
      provider: this.id,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUnits
    });

    return result;
  }

  getUsage(): ProviderUsageMetric[] {
    return this.metrics;
  }
}

export function createProvider(role: string, rules: RulesConfig, logger?: Logger): JsonProvider {
  const config = rules.providers?.[role];
  if (!config?.type) {
    throw new Error(`No provider configured for role "${role}".`);
  }

  let provider: JsonProvider;
  switch (config.type) {
    case "codex-cli":
      provider = new CodexCliProvider({ config, logger });
      break;
    case "gemini-cli":
      provider = new GeminiCliProvider({ config, logger });
      break;
    case "claude-cli":
      provider = new ClaudeCliProvider({ config, logger });
      break;
    case "openai-compatible":
      provider = new OpenAICompatibleProvider({ config, logger });
      break;
    default:
      throw new Error(`Unsupported provider type "${config.type}" for role "${role}".`);
  }

  return new UsageTrackingProvider(provider, role as ProviderRole);
}
