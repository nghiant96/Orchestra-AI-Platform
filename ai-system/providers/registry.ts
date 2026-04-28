import { CodexCliProvider } from "./codex-cli.js";
import { GeminiCliProvider } from "./gemini-cli.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { estimateProviderCost } from "../utils/cost-calculator.js";
import { estimateTokenCount } from "../utils/string.js";
import type { JsonProvider, Logger, RulesConfig, ProviderUsageMetric, ProviderRole, RunJsonOptions } from "../types.js";

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
    this.metrics.push(estimateProviderCost({
      role: this.role,
      provider: this.id,
      promptTokens,
      completionTokens
    }));

    return result;
  }

  getUsage(): ProviderUsageMetric[] {
    return this.metrics;
  }
}

export class FailoverJsonProvider implements JsonProvider {
  private role: ProviderRole;
  private rules: RulesConfig;
  private logger?: Logger;
  private currentProvider: JsonProvider;
  private primaryProviderId: string;
  private failedProviders = new Set<string>();
  private accumulatedMetrics: ProviderUsageMetric[] = [];

  constructor({
    role,
    rules,
    logger,
    initialProvider
  }: {
    role: ProviderRole;
    rules: RulesConfig;
    logger?: Logger;
    initialProvider: JsonProvider;
  }) {
    this.role = role;
    this.rules = rules;
    this.logger = logger;
    this.currentProvider = initialProvider;
    this.primaryProviderId = initialProvider.id;
  }

  get id() {
    return this.currentProvider.id;
  }

  async runJson<T = unknown>(options: RunJsonOptions): Promise<T> {
    try {
      return await this.currentProvider.runJson<T>(options);
    } catch (error) {
      if (this.isQuotaOrCapacityError(error)) {
        const fallback = this.findFallbackProvider();
        if (fallback) {
          this.logger?.warn(`Provider ${this.currentProvider.id} failed with quota/capacity issue. Switching to fallback: ${fallback.id}`);
          this.failedProviders.add(this.currentProvider.id);
          // Store usage from the failed provider before switching
          if ((this.currentProvider as any).getUsage) {
            this.accumulatedMetrics.push(...(this.currentProvider as any).getUsage());
          }
          this.currentProvider = fallback;
          return await this.runJson<T>(options);
        }
      }
      throw error;
    }
  }

  getUsage(): ProviderUsageMetric[] {
    const currentMetrics = (this.currentProvider as any).getUsage?.() ?? [];
    return [...this.accumulatedMetrics, ...currentMetrics];
  }

  private isQuotaOrCapacityError(error: unknown): boolean {
    const message = String(error).toLowerCase();
    return ["quota exceeded", "rate limit", "capacity", "429", "503", "overloaded"].some(needle => message.includes(needle));
  }

  private findFallbackProvider(): JsonProvider | null {
    // Try to find another provider in rules that we haven't tried yet for this run
    const allProviders = Object.entries(this.rules.providers)
      .filter(([_, conf]) => conf?.type && !this.failedProviders.has(conf.type) && conf.type !== this.currentProvider.id)
      .map(([_, conf]) => conf.type);

    if (allProviders.length === 0) {
      return null;
    }

    // Prefer gemini-cli as a safe fallback if available, else pick the first one
    const preferredFallback = allProviders.includes("gemini-cli") ? "gemini-cli" : allProviders[0];
    if (!preferredFallback) return null;

    const config = Object.values(this.rules.providers).find(p => p.type === preferredFallback);
    if (!config) return null;

    const baseProvider = createBaseProvider(preferredFallback, config, this.logger);
    return new UsageTrackingProvider(baseProvider, this.role);
  }
}

export function createProvider(role: string, rules: RulesConfig, logger?: Logger): JsonProvider {
  const config = rules.providers?.[role];
  if (!config?.type) {
    throw new Error(`No provider configured for role "${role}".`);
  }

  const baseProvider = createBaseProvider(config.type, config, logger);
  const tracked = new UsageTrackingProvider(baseProvider, role as ProviderRole);
  
  return new FailoverJsonProvider({
    role: role as ProviderRole,
    rules,
    logger,
    initialProvider: tracked
  });
}

function createBaseProvider(type: string, config: any, logger?: Logger): JsonProvider {
  switch (type) {
    case "codex-cli":
      return new CodexCliProvider({ config, logger });
    case "gemini-cli":
      return new GeminiCliProvider({ config, logger });
    case "claude-cli":
      return new ClaudeCliProvider({ config, logger });
    case "openai-compatible":
      return new OpenAICompatibleProvider({ config, logger });
    default:
      throw new Error(`Unsupported provider type "${type}"`);
  }
}
