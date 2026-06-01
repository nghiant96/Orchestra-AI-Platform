const PRESET_ENV_KEYS = [
    "AI_SYSTEM_PROVIDER",
    "AI_SYSTEM_PLANNER_PROVIDER",
    "AI_SYSTEM_REVIEWER_PROVIDER",
    "AI_SYSTEM_GENERATOR_PROVIDER",
    "AI_SYSTEM_FIXER_PROVIDER",
    "AI_SYSTEM_BASE_URL",
    "AI_SYSTEM_API_KEY",
    "AI_SYSTEM_MODEL",
    "AI_SYSTEM_OPENAI_BASE_URL",
    "AI_SYSTEM_OPENAI_API_KEY",
    "AI_SYSTEM_OPENAI_MODEL"
];
const PRESET_ENV_BASELINE = new Map(PRESET_ENV_KEYS.map((key) => [key, process.env[key]]));
export function applyProviderPreset(preset) {
    resetPresetEnv();
    if (!preset) {
        return;
    }
    const normalized = String(preset).trim().toLowerCase();
    if (!normalized || normalized === "default") {
        return;
    }
    if (normalized === "local" || normalized === "local-cli") {
        setManagedEnv("AI_SYSTEM_PROVIDER", "local-cli");
        return;
    }
    if (normalized === "9router") {
        setManagedEnv("AI_SYSTEM_PROVIDER", "9router");
        return;
    }
    if (["openai-compatible", "agy-cli", "claude-cli", "codex-cli"].includes(normalized)) {
        setManagedEnv("AI_SYSTEM_PROVIDER", normalized);
        return;
    }
    throw new Error(`Unsupported provider preset "${preset}".`);
}
export function setAllRoleProviders(providerType) {
    setManagedEnv("AI_SYSTEM_PLANNER_PROVIDER", providerType);
    setManagedEnv("AI_SYSTEM_REVIEWER_PROVIDER", providerType);
    setManagedEnv("AI_SYSTEM_GENERATOR_PROVIDER", providerType);
    setManagedEnv("AI_SYSTEM_FIXER_PROVIDER", providerType);
}
function resetPresetEnv() {
    for (const key of PRESET_ENV_KEYS) {
        const baseline = PRESET_ENV_BASELINE.get(key);
        if (typeof baseline === "undefined") {
            delete process.env[key];
        }
        else {
            process.env[key] = baseline;
        }
    }
}
function setManagedEnv(key, value) {
    process.env[key] = value;
}
