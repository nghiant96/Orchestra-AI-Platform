import { createHash, timingSafeEqual } from "node:crypto";
import type { AuditRole } from "../core/audit-log.js";

export type TokenRole = "server" | "worker" | "hermes" | "dashboard";

export interface TokenPolicyConfig {
  serverToken?: string;
  workerToken?: string;
  hermesToken?: string;
}

export interface TokenValidationResult {
  role: TokenRole;
  valid: boolean;
  reason?: string;
}

/**
 * Compare a presented token with the expected secret in constant time. `===`
 * returns at the first differing byte, which lets a caller recover the secret
 * one byte at a time by timing. Hashing first gives both sides the same length,
 * so the comparison leaks neither the content nor the length of the secret.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  if (!expected) return false;
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function resolveTokenRole(config: TokenPolicyConfig, headerValue: string): TokenValidationResult {
  const token = headerValue.startsWith("Bearer ") ? headerValue.slice(7) : headerValue;

  if (config.hermesToken && tokensMatch(token, config.hermesToken)) {
    return { role: "hermes", valid: true };
  }

  if (config.workerToken && tokensMatch(token, config.workerToken)) {
    return { role: "worker", valid: true };
  }

  if (config.serverToken && tokensMatch(token, config.serverToken)) {
    return { role: "server", valid: true };
  }

  if (!config.serverToken && !config.workerToken && !config.hermesToken) {
    return { role: "dashboard", valid: true };
  }

  return { role: "server", valid: false, reason: "Invalid token" };
}

export function validateTokenConfiguration(config: TokenPolicyConfig): void {
  const configuredTokens = [
    ["server", config.serverToken],
    ["worker", config.workerToken],
    ["hermes", config.hermesToken]
  ] as const;

  const seen = new Map<string, string>();
  for (const [role, rawToken] of configuredTokens) {
    const token = String(rawToken ?? "").trim();
    if (!token) {
      continue;
    }

    if (isPlaceholderToken(token)) {
      throw new Error(`Token for ${role} role must be set to a real secret, not a placeholder value.`);
    }

    const existingRole = seen.get(token);
    if (existingRole) {
      throw new Error(`Auth tokens for ${existingRole} and ${role} must be different.`);
    }
    seen.set(token, role);
  }
}

export function canAccessRoute(
  role: TokenRole,
  route: string,
  method: string = "GET"
): boolean {
  const normalizedMethod = method.toUpperCase();

  if (role === "hermes") {
    // Config holds the verification commands the server executes, so writing
    // it is code execution on the host. Hermes may read it but not change it.
    if (route === "/config" && normalizedMethod !== "GET") return false;
    if (route.startsWith("/workers")) return false;
    if (route.startsWith("/jobs/") && (route.endsWith("/start") || route.endsWith("/complete") || route.endsWith("/fail") || route.endsWith("/checkpoint"))) return false;
    if (route.startsWith("/queue/")) return false;
    return true;
  }

  if (role === "worker") {
    if (normalizedMethod === "POST" && route === "/workers") return true;
    if (normalizedMethod === "POST" && /^\/workers\/[^/]+\/heartbeat$/.test(route)) return true;
    if (normalizedMethod === "POST" && /^\/workers\/[^/]+\/jobs\/claim$/.test(route)) return true;
    if (normalizedMethod === "POST" && /^\/workers\/[^/]+\/jobs\/[^/]+\/logs$/.test(route)) return true;
    if (normalizedMethod === "POST" && /^\/jobs\/[^/]+\/(start|complete|fail|checkpoint)$/.test(route)) return true;
    if (route === "/config") return false;
    if (route.startsWith("/queue/")) return false;
    if (route.startsWith("/audit")) return false;
    if (route.startsWith("/stats")) return false;
    return false;
  }

  return true;
}

/**
 * The highest actor role a token may act as. The server token (and an
 * unauthenticated local server) is the root credential; hermes and worker
 * tokens are capped no matter what role headers the client sends.
 */
export function maxActorRoleForToken(role: TokenRole): AuditRole | undefined {
  if (role === "hermes") return "operator";
  if (role === "worker") return "viewer";
  return undefined;
}

function isPlaceholderToken(token: string): boolean {
  return new Set([
    "change-me",
    "change-me-worker",
    "smoke-server-token",
    "smoke-worker-token"
  ]).has(token);
}
