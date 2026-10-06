import type http from "node:http";

const ALLOWED_METHODS = "GET, POST, OPTIONS, PUT, PATCH, DELETE";
const ALLOWED_HEADERS = "Content-Type, Authorization, X-API-Key, X-AI-System-Actor, X-AI-System-Role";

/**
 * Build the set of browser origins allowed to call the API cross-origin, from
 * `AI_SYSTEM_CORS_ORIGINS`-style entries. Empty means same-origin only, which
 * is all the dashboard needs: it reaches the API through the Vite proxy.
 *
 * Entries must be exact origins. A wildcard is refused because any page a user
 * visits could then drive the API with credentials the browser holds for it.
 */
export function parseCorsOrigins(entries: Iterable<string>): Set<string> {
  const origins = new Set<string>();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry === "*") {
      throw new Error("AI_SYSTEM_CORS_ORIGINS does not accept '*'; list each allowed origin explicitly.");
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`AI_SYSTEM_CORS_ORIGINS entry is not a valid origin: ${entry}`);
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`AI_SYSTEM_CORS_ORIGINS entry must be scheme://host[:port] only: ${entry}`);
    }
    origins.add(url.origin);
  }
  return origins;
}

/** Grant CORS only to an allowlisted request origin, echoed back exactly. */
export function applyCorsHeaders(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowedOrigins: ReadonlySet<string>
): void {
  if (allowedOrigins.size === 0) return;
  // The response now depends on Origin, so shared caches must key on it.
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
}
