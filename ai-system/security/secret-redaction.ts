const REDACTION_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: "openai-api-key", pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: "sk-REDACTED" },
  { name: "github-token", pattern: /ghp_[A-Za-z0-9]{20,}/g, replacement: "ghp_REDACTED" },
  { name: "github-classic-token", pattern: /gho_[A-Za-z0-9]{20,}/g, replacement: "gho_REDACTED" },
  { name: "github-fine-grained-token", pattern: /github_pat_[A-Za-z0-9_]{16,}/g, replacement: "github_pat_REDACTED" },
  { name: "gitlab-token", pattern: /glpat-[A-Za-z0-9_-]{16,}/g, replacement: "glpat-REDACTED" },
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g, replacement: "AKIAREDACTED" },
  { name: "aws-secret-key", pattern: /aws_secret_access_key[=:]\s*["']?[A-Za-z0-9/+=]{40,}["']?/gi, replacement: "aws_secret_access_key=REDACTED" },
  { name: "private-key-header", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, replacement: "-----BEGIN REDACTED PRIVATE KEY-----" },
  { name: "private-key-footer", pattern: /-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "-----END REDACTED PRIVATE KEY-----" },
  { name: "jwt-token", pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: "eyJ.REDACTED.REDACTED" },
  { name: "google-credentials", pattern: /GOOGLE_APPLICATION_CREDENTIALS[=:]\s*["']?[^"';\s]+["']?/gi, replacement: "GOOGLE_APPLICATION_CREDENTIALS=REDACTED" },
  { name: "bearer-token-value", pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/gi, replacement: "Bearer REDACTED" },
  { name: "npm-token", pattern: /npm_[A-Za-z0-9]{12,}/g, replacement: "npm_REDACTED" },
  { name: "generic-url-password", pattern: /https?:\/\/[^:]+:[^@]+@/g, replacement: "https://REDACTED@/" },
  { name: "slack-token", pattern: /xox[bpras]-[A-Za-z0-9-]{10,}/g, replacement: "xox-REDACTED" },
  // Our own tokens are arbitrary strings that no vendor pattern recognises.
  // Catch them where they are labelled: `env` / `printenv` output and dumped
  // JSON such as `console.log(process.env)`.
  {
    name: "sensitive-env-assignment",
    // Values a vendor pattern already masked keep their more specific label.
    pattern: /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)=(?![^\s"'`]*REDACTED)[^\s"'`]+/g,
    replacement: "$1=REDACTED"
  },
  {
    name: "sensitive-json-field",
    pattern: /(["']?[A-Za-z0-9_]*(?:token|secret|password|passwd|api_?key|access_?key|private_?key)[A-Za-z0-9_]*["']?\s*:\s*)(["'])(?![^"'\n]*REDACTED)[^"'\n]*\2/gi,
    replacement: "$1$2REDACTED$2"
  },
];

/** Environment variables whose names say they hold a secret. */
const SENSITIVE_ENV_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

/**
 * The values of this process's secret-named environment variables, longest
 * first. Scrubbing them by value catches a secret however it was printed —
 * the labelled patterns above miss `echo $AI_SYSTEM_SERVER_TOKEN`.
 */
function sensitiveEnvValues(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

export function redactSecrets(input: string): string {
  let result = input;
  for (const value of sensitiveEnvValues()) {
    result = result.split(value).join("REDACTED");
  }
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Placeholder the API returns in place of a secret config value. */
export const MASKED_SECRET = "********";

const SECRET_CONFIG_KEY = /^(?:.*_)?(?:api_?key|secret|token|password|passwd|private_?key)$/i;

/**
 * Deep-copy a config object with every secret-named string field masked.
 * Keys are matched whole (`secret`, `api_key`, `auth_token`), so a field such
 * as `max_tokens` or `api_key_env` — which names a variable, not a secret — is
 * left alone.
 */
export function maskSecretFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskSecretFields(item)) as T;
  }
  if (value && typeof value === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
      masked[key] = typeof field === "string" && SECRET_CONFIG_KEY.test(key) && field ? MASKED_SECRET : maskSecretFields(field);
    }
    return masked as T;
  }
  return value;
}

/**
 * Put real secrets back where a config update carries the mask placeholder,
 * so a client that saves back what GET /config returned does not overwrite
 * them with asterisks. Arrays are matched by index because the config merge
 * replaces arrays whole. A placeholder with nothing to restore is dropped.
 */
export function restoreMaskedSecrets<T>(incoming: T, existing: unknown): T {
  if (incoming === MASKED_SECRET) {
    return existing as T;
  }
  if (Array.isArray(incoming)) {
    return incoming.map((item, index) => restoreMaskedSecrets(item, Array.isArray(existing) ? existing[index] : undefined)) as T;
  }
  if (incoming && typeof incoming === "object") {
    const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
    const restored: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(incoming as Record<string, unknown>)) {
      const value = restoreMaskedSecrets(field, base[key]);
      if (value !== undefined) restored[key] = value;
    }
    return restored as T;
  }
  return incoming;
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = redactSecrets(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? redactSecrets(item)
          : typeof item === "object" && item !== null
            ? redactObject(item as Record<string, unknown>)
            : item
      );
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactJsonString(json: string): string {
  try {
    const parsed = JSON.parse(json);
    const redacted = redactObject(parsed);
    return JSON.stringify(redacted);
  } catch {
    return redactSecrets(json);
  }
}
