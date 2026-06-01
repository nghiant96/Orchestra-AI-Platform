import path from "node:path";
const DEFAULT_PRESERVED_ENV_KEYS = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "TERM",
    "COLORTERM",
    "CI",
    "FORCE_COLOR",
    "LANG",
    "LC_ALL",
    "TZ",
    "PWD",
    "NVM_BIN",
    "NVM_DIR",
    "PNPM_HOME",
    "VOLTA_HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "npm_config_user_agent",
    "npm_config_cache",
    "npm_config_prefix",
    "YARN_CACHE_FOLDER",
    "NODE_OPTIONS"
];
const DEFAULT_SANDBOX_IMAGE = "ai-coding-system:local";
const PROFILE_IMAGES = {
    node: "ai-coding-system:node",
    python: "ai-coding-system:python",
    go: "ai-coding-system:go",
    rust: "ai-coding-system:rust"
};
export function resolveToolSandbox(config) {
    const mode = normalizeSandboxMode(config?.mode);
    const image = typeof config?.image === "string" ? config.image : undefined;
    if (mode === "inherit") {
        return {
            mode,
            env: { ...process.env },
            image,
            imageProfile: normalizeImageProfile(config?.image_profile),
            autoBuild: config?.auto_build === true,
            dockerfile: normalizeDockerfile(config?.dockerfile)
        };
    }
    const env = {};
    const includeKeys = new Set([...DEFAULT_PRESERVED_ENV_KEYS, ...(config?.include_env ?? [])]);
    for (const key of includeKeys) {
        const value = process.env[key];
        if (typeof value === "string") {
            env[key] = value;
        }
    }
    for (const [key, value] of Object.entries(config?.extra_env ?? {})) {
        env[key] = value;
    }
    return {
        mode,
        env,
        image,
        imageProfile: normalizeImageProfile(config?.image_profile),
        autoBuild: config?.auto_build === true,
        dockerfile: normalizeDockerfile(config?.dockerfile)
    };
}
export function resolveSandboxImage(sandbox, options) {
    const effectiveProfile = sandbox.imageProfile === "auto" ? normalizeImageProfile(options.projectType || "node") : sandbox.imageProfile;
    const image = sandbox.image || PROFILE_IMAGES[effectiveProfile] || DEFAULT_SANDBOX_IMAGE;
    const dockerfile = path.resolve(options.repoRoot, sandbox.dockerfile || "Dockerfile");
    return {
        image,
        imageProfile: effectiveProfile,
        dockerfile,
        explicitImage: Boolean(sandbox.image),
        buildHint: `docker build -t ${image} -f ${dockerfile} ${path.resolve(options.repoRoot)}`
    };
}
function normalizeSandboxMode(mode) {
    if (mode === "docker")
        return "docker";
    return mode === "clean-env" ? "clean-env" : "inherit";
}
function normalizeImageProfile(value) {
    const normalized = String(value || "auto").trim().toLowerCase();
    if (normalized === "node" || normalized === "python" || normalized === "go" || normalized === "rust") {
        return normalized;
    }
    return "auto";
}
function normalizeDockerfile(value) {
    if (typeof value !== "string" || !value.trim()) {
        return undefined;
    }
    return value.trim();
}
