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

export function resolveTokenRole(config: TokenPolicyConfig, headerValue: string): TokenValidationResult {
  const token = headerValue.startsWith("Bearer ") ? headerValue.slice(7) : headerValue;

  if (config.hermesToken && token === config.hermesToken) {
    return { role: "hermes", valid: true };
  }

  if (config.workerToken && token === config.workerToken) {
    return { role: "worker", valid: true };
  }

  if (config.serverToken && token === config.serverToken) {
    return { role: "server", valid: true };
  }

  if (!config.serverToken && !config.workerToken && !config.hermesToken) {
    return { role: "dashboard", valid: true };
  }

  return { role: "server", valid: false, reason: "Invalid token" };
}

export function canAccessRoute(
  role: TokenRole,
  route: string,
  method: string = "GET"
): boolean {
  const normalizedMethod = method.toUpperCase();

  if (role === "hermes") {
    if (route.startsWith("/workers")) return false;
    if (route.startsWith("/jobs/") && (route.endsWith("/complete") || route.endsWith("/fail") || route.endsWith("/checkpoint"))) return false;
    if (route.startsWith("/queue/")) return false;
    return true;
  }

  if (role === "worker") {
    if (normalizedMethod === "POST" && route === "/workers") return true;
    if (normalizedMethod === "POST" && /^\/workers\/[^/]+\/heartbeat$/.test(route)) return true;
    if (normalizedMethod === "POST" && /^\/workers\/[^/]+\/jobs\/claim$/.test(route)) return true;
    if (normalizedMethod === "POST" && /^\/jobs\/[^/]+\/(complete|fail|checkpoint)$/.test(route)) return true;
    if (route === "/config") return false;
    if (route.startsWith("/queue/")) return false;
    if (route.startsWith("/audit")) return false;
    if (route.startsWith("/stats")) return false;
    return false;
  }

  return true;
}
