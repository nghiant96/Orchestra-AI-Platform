import { CodexCliProvider } from "./codex-cli.js";
import { AgyCliProvider } from "./agy-cli.js";
import { ClaudeCliProvider } from "./claude-cli.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { estimateProviderCost } from "../utils/cost-calculator.js";
import { estimateTokenCount } from "../utils/string.js";
export class UsageTrackingProvider {
    base;
    role;
    metrics = [];
    constructor(base, role) {
        this.base = base;
        this.role = role;
    }
    get id() {
        return this.base.id;
    }
    async runJson(options) {
        const promptTokens = estimateTokenCount(options.systemPrompt || "") + estimateTokenCount(options.prompt || "");
        const result = await this.base.runJson(options);
        const completionTokens = estimateTokenCount(JSON.stringify(result));
        this.metrics.push(estimateProviderCost({
            role: this.role,
            provider: this.id,
            promptTokens,
            completionTokens
        }));
        return result;
    }
    getUsage() {
        return this.metrics;
    }
}
export class FailoverJsonProvider {
    role;
    rules;
    logger;
    currentProvider;
    primaryProviderId;
    failedProviders = new Set();
    accumulatedMetrics = [];
    constructor({ role, rules, logger, initialProvider }) {
        this.role = role;
        this.rules = rules;
        this.logger = logger;
        this.currentProvider = initialProvider;
        this.primaryProviderId = initialProvider.id;
    }
    get id() {
        return this.currentProvider.id;
    }
    async runJson(options) {
        try {
            return await this.currentProvider.runJson(options);
        }
        catch (error) {
            const isQuotaError = this.isQuotaOrCapacityError(error);
            const fallback = this.findFallbackProvider();
            if (fallback && isQuotaError) {
                this.logger?.warn(`Provider ${this.currentProvider.id} encountered an issue. Switching to fallback: ${fallback.id}`);
                this.failedProviders.add(this.currentProvider.id);
                if (this.currentProvider.getUsage) {
                    this.accumulatedMetrics.push(...this.currentProvider.getUsage());
                }
                this.currentProvider = fallback;
                // Retry the request with the new provider
                return await this.runJson(options);
            }
            throw error;
        }
    }
    getUsage() {
        const currentMetrics = this.currentProvider.getUsage?.() ?? [];
        return [...this.accumulatedMetrics, ...currentMetrics];
    }
    isQuotaOrCapacityError(error) {
        const message = String(error).toLowerCase();
        return ["quota exceeded", "rate limit", "capacity", "429", "503", "overloaded"].some(needle => message.includes(needle));
    }
    findFallbackProvider() {
        // Try to find another provider in rules that we haven't tried yet for this run
        const allProviders = Object.entries(this.rules.providers)
            .filter(([_, conf]) => conf?.type && !this.failedProviders.has(conf.type) && conf.type !== this.currentProvider.id)
            .map(([_, conf]) => conf.type);
        if (allProviders.length === 0) {
            return null;
        }
        // Prefer agy-cli as a safe fallback if available, else pick the first one
        const preferredFallback = allProviders.includes("agy-cli") ? "agy-cli" : allProviders[0];
        if (!preferredFallback)
            return null;
        const config = Object.values(this.rules.providers).find(p => p.type === preferredFallback);
        if (!config)
            return null;
        const baseProvider = createBaseProvider(preferredFallback, config, this.logger);
        return new UsageTrackingProvider(baseProvider, this.role);
    }
}
export function createProvider(role, rules, logger) {
    const config = rules.providers?.[role];
    if (!config?.type) {
        throw new Error(`No provider configured for role "${role}".`);
    }
    const baseProvider = createBaseProvider(config.type, config, logger);
    const tracked = new UsageTrackingProvider(baseProvider, role);
    return new FailoverJsonProvider({
        role: role,
        rules,
        logger,
        initialProvider: tracked
    });
}
function createBaseProvider(type, config, logger) {
    switch (type) {
        case "codex-cli":
            return new CodexCliProvider({ config, logger });
        case "agy-cli":
            return new AgyCliProvider({ config, logger });
        case "claude-cli":
            return new ClaudeCliProvider({ config, logger });
        case "openai-compatible":
            return new OpenAICompatibleProvider({ config, logger });
        default:
            throw new Error(`Unsupported provider type "${type}"`);
    }
}
