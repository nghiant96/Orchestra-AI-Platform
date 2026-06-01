export class McpAuthError extends Error {
  constructor(message: string, public statusCode = 401) {
    super(message);
    this.name = "McpAuthError";
  }
}

export function assertHermesAuth(token: unknown, expectedToken = process.env.ORCHESTRA_HERMES_TOKEN?.trim() || ""): void {
  if (!expectedToken) {
    return;
  }
  const value = typeof token === "string" ? token.trim() : "";
  const normalized = value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : value;
  if (normalized !== expectedToken) {
    throw new McpAuthError("Invalid Hermes token", 401);
  }
}
