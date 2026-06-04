const PLACEHOLDER_TOKENS = new Set([
  "change-me",
  "change-me-worker",
  "smoke-server-token",
  "smoke-worker-token"
]);

export function resolveServerAuthToken(rawToken: string | undefined): string {
  const token = String(rawToken ?? "").trim();
  if (!token) {
    throw new Error("AI_SYSTEM_SERVER_TOKEN is required in server mode.");
  }

  if (PLACEHOLDER_TOKENS.has(token)) {
    throw new Error("AI_SYSTEM_SERVER_TOKEN must be set to a real secret, not a placeholder value.");
  }

  return token;
}
