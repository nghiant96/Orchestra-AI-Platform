import type { ProviderRole, ProviderRoutingProfile, RoutingProfileName, RulesConfig } from "../types.js";

export const PROFILE_NAMES: RoutingProfileName[] = ["fast", "balanced", "safe"];
export const PROVIDER_ROLES: ProviderRole[] = ["planner", "reviewer", "generator", "fixer"];

const DEFAULT_ROUTING_PROFILES: Record<RoutingProfileName, ProviderRoutingProfile> = {
  fast: {
    planner: "gemini-cli",
    reviewer: "codex-cli",
    generator: "codex-cli",
    fixer: "codex-cli"
  },
  balanced: {
    planner: "gemini-cli",
    reviewer: "gemini-cli",
    generator: "codex-cli",
    fixer: "codex-cli"
  },
  safe: {
    planner: "gemini-cli",
    reviewer: "claude-cli",
    generator: "codex-cli",
    fixer: "codex-cli"
  }
};

export function createScoreCard(defaultProfile: RoutingProfileName): Record<RoutingProfileName, number> {
  return {
    fast: defaultProfile === "fast" ? 1 : 0,
    balanced: defaultProfile === "balanced" ? 1 : 0,
    safe: defaultProfile === "safe" ? 1 : 0
  };
}

export function getRoutingProfile(rules: RulesConfig, profileName: RoutingProfileName): ProviderRoutingProfile {
  return {
    ...DEFAULT_ROUTING_PROFILES[profileName],
    ...(rules.routing?.profiles?.[profileName] ?? {})
  };
}

export function createRoleProviders(profile: ProviderRoutingProfile, rules: RulesConfig): Record<ProviderRole, string> {
  return {
    planner: resolvePreferredProviderType(rules, [profile.planner, rules.providers.planner.type]),
    reviewer: resolvePreferredProviderType(rules, [profile.reviewer, rules.providers.reviewer.type]),
    generator: resolvePreferredProviderType(rules, [profile.generator, rules.providers.generator.type]),
    fixer: resolvePreferredProviderType(rules, [profile.fixer, rules.providers.fixer.type])
  };
}

export function resolvePreferredProviderType(rules: RulesConfig, candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const normalized = normalizeProviderType(candidate);
    if (normalized && hasProviderTemplate(rules, normalized)) {
      return normalized;
    }
  }

  return normalizeProviderType(candidates[0]) || "gemini-cli";
}

export function hasProviderTemplate(rules: RulesConfig, providerType: string): boolean {
  return Object.values(rules.providers).some((provider) => provider?.type === providerType);
}

export function normalizeProfileName(value?: string): RoutingProfileName | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (PROFILE_NAMES.includes(normalized as RoutingProfileName)) {
    return normalized as RoutingProfileName;
  }
  return null;
}

export function mapRiskToProfile(value?: string): RoutingProfileName | null {
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

export function normalizeProviderType(value?: string): string {
  return String(value || "").trim().toLowerCase();
}

export function isProfileName(value: string): value is RoutingProfileName {
  return PROFILE_NAMES.includes(value as RoutingProfileName);
}
