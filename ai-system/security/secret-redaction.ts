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
];

export function redactSecrets(input: string): string {
  let result = input;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
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
