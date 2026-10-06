import type http from "node:http";

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the key's window resets; meaningful when not allowed. */
  retryAfterSeconds: number;
}

/**
 * Count events per key in fixed windows. Memory stays bounded by the number of
 * keys seen within one window: expired entries are swept as the clock passes.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private nextSweepAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Count one event for `key` and report whether it is within the limit. */
  hit(key: string): RateLimitDecision {
    const entry = this.current(key, true)!;
    entry.count += 1;
    return this.decide(entry, entry.count <= this.limit);
  }

  /** Report whether `key` has already used up its window, without counting. */
  check(key: string): RateLimitDecision {
    const entry = this.current(key, false);
    return entry ? this.decide(entry, entry.count < this.limit) : { allowed: true, retryAfterSeconds: 0 };
  }

  private current(key: string, create: boolean): { count: number; resetAt: number } | undefined {
    const now = this.now();
    if (now >= this.nextSweepAt) {
      for (const [candidate, window] of this.windows) {
        if (window.resetAt <= now) this.windows.delete(candidate);
      }
      this.nextSweepAt = now + this.windowMs;
    }

    let entry = this.windows.get(key);
    if (entry && entry.resetAt <= now) {
      this.windows.delete(key);
      entry = undefined;
    }
    if (!entry && create) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, entry);
    }
    return entry;
  }

  private decide(entry: { resetAt: number }, allowed: boolean): RateLimitDecision {
    return { allowed, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - this.now()) / 1000)) };
  }
}

/**
 * The address a request is attributed to. Behind a reverse proxy every request
 * arrives from the proxy, so with `trustProxy` the proxy-appended (last)
 * X-Forwarded-For entry is used. Earlier entries are client-supplied and would
 * let a caller pick its own bucket; only enable this behind a proxy that
 * appends the header.
 */
export function resolveClientAddress(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const last = forwarded[forwarded.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function isLoopbackAddress(address: string): boolean {
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}
