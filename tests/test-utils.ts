import http from "node:http";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Logger } from "../ai-system/types.js";

const readyServers = new WeakSet<http.Server>();

/**
 * Robustly wait for a server to start listening with retries and polling.
 */
export async function listen(server: http.Server): Promise<string> {
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    try {
      await new Promise<void>((resolve, reject) => {
        const errorHandler = (err: Error) => {
          server.off("listening", resolveHandler);
          reject(err);
        };
        const resolveHandler = () => {
          server.off("error", errorHandler);
          resolve();
        };
        server.once("error", errorHandler);
        server.once("listening", resolveHandler);
        server.listen(0, "127.0.0.1");
      });
      break;
    } catch (err) {
      attempts++;
      if (attempts >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

  readyServers.add(server);

  return baseUrl;
}

export async function waitForHttpReady(baseUrl: string, readyPath = "/health"): Promise<void> {
  const maxAttempts = 20;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.get(new URL(readyPath, baseUrl), (res) => {
          res.resume();
          resolve(res.statusCode || 0);
        });
        req.on("error", reject);
        req.end();
      });
      if (statusCode >= 200 && statusCode < 500) {
        return;
      }
    } catch {
      // ignore until the server becomes reachable
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  throw new Error(`Server at ${baseUrl} failed to respond after polling`);
}

/**
 * Safely close a server only if it's actually listening.
 */
export async function closeServer(server: http.Server): Promise<void> {
  if (!readyServers.has(server)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      readyServers.delete(server);
      resolve();
    });
  });
}

/**
 * A logger that does nothing for cleaner test output.
 */
export function silentLogger(): Logger {
  return {
    step() {},
    info() {},
    warn() {},
    error() {},
    success() {}
  };
}

/**
 * Request JSON from the server and assert the response status.
 */
export async function requestJson(
  baseUrl: string,
  method: string,
  pathname: string,
  body?: unknown,
  expectedStatus?: number,
  extraHeaders: Record<string, string> = {}
): Promise<any> {
  const url = new URL(pathname, baseUrl);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...extraHeaders,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
              }
            : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          try {
            if (expectedStatus !== undefined) {
              assert.equal(res.statusCode, expectedStatus);
            } else if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`));
              return;
            }
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
