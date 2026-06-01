import { PROFILE_NAMES, createScoreCard, createRoleProviders, getRoutingProfile as resolveRoutingProfile, mapRiskToProfile, normalizeProfileName, resolvePreferredProviderType } from "./provider-router-utils.js";
import { buildAdaptiveRoutingInsights } from "./provider-router-adaptive.js";
import { buildPlanSignals, buildRepoSignals, buildTaskSignals } from "./provider-router-signals.js";
export async function buildRoutingDecision({ repoRoot, rules, task, stage, plan, forcedProfile }) {
    const routing = rules.routing ?? {};
    const defaultProfile = normalizeProfileName(routing.default_profile) || "balanced";
    const enabled = normalizeBooleanEnv(process.env.AI_SYSTEM_ROUTING_ENABLED, routing.enabled ?? true);
    if (!enabled) {
        const roleProviders = resolveRoleProviders(rules, defaultProfile, stage, plan, []);
        return {
            stage,
            enabled: false,
            profile: defaultProfile,
            reason: "routing disabled",
            roleProviders,
            appliedRoles: {},
            reasons: ["Dynamic routing disabled."],
            signals: []
        };
    }
    const adaptiveInsights = await buildAdaptiveRoutingInsights({ repoRoot, rules, routing, task, stage, plan });
    const signals = await collectSignals({ repoRoot, rules, routing, task, stage, plan, adaptiveInsights });
    const forced = forcedProfile || normalizeProfileName(process.env.AI_SYSTEM_ROUTING_PROFILE) || mapRiskToProfile(process.env.AI_SYSTEM_RISK_PROFILE);
    const profile = forced || chooseProfile(defaultProfile, signals);
    const reason = forced
        ? `forced by ${forcedProfile ? "plan-aware rerouting" : process.env.AI_SYSTEM_ROUTING_PROFILE ? "AI_SYSTEM_ROUTING_PROFILE" : "AI_SYSTEM_RISK_PROFILE"}`
        : signals.find((signal) => signal.matched && signal.scores?.[profile])?.details || "score-based routing";
    const roleProviders = resolveRoleProviders(rules, profile, stage, plan, signals);
    return {
        stage,
        enabled: true,
        profile,
        reason,
        roleProviders,
        appliedRoles: {},
        reasons: signals.filter((signal) => signal.matched).map((signal) => signal.details || signal.name),
        signals
    };
}
export function chooseProfile(defaultProfile, signals) {
    const scores = createScoreCard(defaultProfile);
    for (const signal of signals) {
        if (!signal.matched || !signal.scores) {
            continue;
        }
        for (const profile of PROFILE_NAMES) {
            scores[profile] += signal.scores[profile] ?? 0;
        }
    }
    let winner = defaultProfile;
    let winnerScore = scores[winner];
    for (const profile of PROFILE_NAMES) {
        if (scores[profile] > winnerScore) {
            winner = profile;
            winnerScore = scores[profile];
        }
    }
    return winner;
}
export function resolveRoleProviders(rules, profileName, stage, plan, signals) {
    const profile = resolveRoutingProfile(rules, profileName);
    const roleProviders = createRoleProviders(profile, rules);
    if (stage === "implementation") {
        const docsOnly = signals.some((signal) => signal.name === "plan:docs-only" && signal.matched);
        const riskyPlan = signals.some((signal) => signal.name === "plan:risky-paths" && signal.matched);
        const writeCount = plan?.writeTargets?.length ?? 0;
        if (docsOnly) {
            roleProviders.reviewer = resolvePreferredProviderType(rules, ["codex-cli", roleProviders.reviewer]);
        }
        else if (riskyPlan || writeCount > 3) {
            roleProviders.reviewer = resolvePreferredProviderType(rules, ["claude-cli", roleProviders.reviewer]);
        }
    }
    return roleProviders;
}
export function getRoutingProfile(rules, profileName) {
    return resolveRoutingProfile(rules, profileName);
}
async function collectSignals({ repoRoot, rules: _rules, routing, task, stage, plan, adaptiveInsights }) {
    const signals = [];
    signals.push(...(await buildTaskSignals(task, routing ?? {})));
    signals.push(...(await buildRepoSignals(repoRoot)));
    signals.push(...adaptiveInsights.signals);
    if (stage === "implementation") {
        signals.push(...buildPlanSignals(plan));
    }
    return signals;
}
function normalizeBooleanEnv(value, fallback) {
    if (typeof value === "undefined") {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
        return false;
    }
    if (["1", "true", "on", "yes", "enabled"].includes(normalized)) {
        return true;
    }
    return fallback;
}
