export const PROFILE_NAMES = ["fast", "balanced", "safe"];
export const PROVIDER_ROLES = ["planner", "reviewer", "generator", "fixer"];
const DEFAULT_ROUTING_PROFILES = {
    fast: {
        planner: "agy-cli",
        reviewer: "codex-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
    },
    balanced: {
        planner: "agy-cli",
        reviewer: "agy-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
    },
    safe: {
        planner: "agy-cli",
        reviewer: "claude-cli",
        generator: "codex-cli",
        fixer: "codex-cli"
    }
};
export function createScoreCard(defaultProfile) {
    return {
        fast: defaultProfile === "fast" ? 1 : 0,
        balanced: defaultProfile === "balanced" ? 1 : 0,
        safe: defaultProfile === "safe" ? 1 : 0
    };
}
export function getRoutingProfile(rules, profileName) {
    return {
        ...DEFAULT_ROUTING_PROFILES[profileName],
        ...(rules.routing?.profiles?.[profileName] ?? {})
    };
}
export function createRoleProviders(profile, rules) {
    return {
        planner: resolvePreferredProviderType(rules, [profile.planner, rules.providers.planner.type]),
        reviewer: resolvePreferredProviderType(rules, [profile.reviewer, rules.providers.reviewer.type]),
        generator: resolvePreferredProviderType(rules, [profile.generator, rules.providers.generator.type]),
        fixer: resolvePreferredProviderType(rules, [profile.fixer, rules.providers.fixer.type])
    };
}
export function resolvePreferredProviderType(rules, candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeProviderType(candidate);
        if (normalized && hasProviderTemplate(rules, normalized)) {
            return normalized;
        }
    }
    return normalizeProviderType(candidates[0]) || "agy-cli";
}
export function hasProviderTemplate(rules, providerType) {
    return Object.values(rules.providers).some((provider) => provider?.type === providerType);
}
export function normalizeProfileName(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (PROFILE_NAMES.includes(normalized)) {
        return normalized;
    }
    return null;
}
export function mapRiskToProfile(value) {
    const normalized = String(value || "").trim().toLowerCase();
    switch (normalized) {
        case "low":
            return "fast";
        case "medium":
            return "balanced";
        case "high":
            return "safe";
        default:
            return normalizeProfileName(normalized);
    }
}
export function normalizeProviderType(value) {
    return String(value || "").trim().toLowerCase();
}
export function isProfileName(value) {
    return PROFILE_NAMES.includes(value);
}
