import type { ToolSandboxConfig, ToolSandboxMode } from "../types.js";

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
] as const;

export interface ResolvedToolSandbox {
  mode: ToolSandboxMode;
  env: NodeJS.ProcessEnv;
  image?: string;
}

export function resolveToolSandbox(config?: ToolSandboxConfig): ResolvedToolSandbox {
  const mode = normalizeSandboxMode(config?.mode);
  const image = typeof config?.image === "string" ? config.image : undefined;
  if (mode === "inherit") {
    return {
      mode,
      env: { ...process.env },
      image
    };
  }

  const env: NodeJS.ProcessEnv = {};
  const includeKeys = new Set<string>([...DEFAULT_PRESERVED_ENV_KEYS, ...(config?.include_env ?? [])]);
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
    image
  };
}

function normalizeSandboxMode(mode: unknown): ToolSandboxMode {
  if (mode === "docker") return "docker";
  return mode === "clean-env" ? "clean-env" : "inherit";
}
