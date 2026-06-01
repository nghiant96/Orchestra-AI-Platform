const DEFAULT_PROVIDER_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID"
];

export function buildProviderEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const keys = [
    ...DEFAULT_PROVIDER_ENV_KEYS,
    ...parseCsv(process.env.ORCHESTRA_WORKER_PROVIDER_ENV_KEYS)
  ];
  const env: Record<string, string> = {};
  for (const key of new Set(keys)) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function parseCsv(value: string | undefined): string[] {
  return value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : [];
}
