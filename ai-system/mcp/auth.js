export class McpAuthError extends Error {
    statusCode;
    constructor(message, statusCode = 401) {
        super(message);
        this.statusCode = statusCode;
        this.name = "McpAuthError";
    }
}
export function assertHermesAuth(token, expectedToken = process.env.ORCHESTRA_HERMES_TOKEN?.trim() || "") {
    if (!expectedToken) {
        return;
    }
    const value = typeof token === "string" ? token.trim() : "";
    const normalized = value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : value;
    if (normalized !== expectedToken) {
        throw new McpAuthError("Invalid Hermes token", 401);
    }
}
