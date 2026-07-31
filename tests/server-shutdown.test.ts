import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { removeTempDir } from "./test-utils.js";

const workspaceRoot = process.cwd();
const serverEntry = path.join(workspaceRoot, "ai-system", "server.ts");
// The child runs from a temp cwd, so tsx has to be resolved by absolute path.
const tsxLoaderPath = path.join(workspaceRoot, "node_modules", "tsx", "dist", "esm", "index.mjs");

/**
 * The graceful-shutdown path only matters if a signal actually reaches it, and
 * that cannot be proven in-process — it needs a real child receiving a real
 * SIGTERM, the way a container runtime delivers one.
 */
test("server drains and exits cleanly on SIGTERM", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "server-shutdown-"));
  let child: ChildProcessWithoutNullStreams | undefined;

  try {
    const port = await findFreePort();
    child = spawn(process.execPath, ["--import", tsxLoaderPath, serverEntry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        AI_SYSTEM_WORKDIR: repoRoot,
        AI_SYSTEM_SERVER_TOKEN: "shutdown-test-token",
        AI_SYSTEM_SHUTDOWN_GRACE_MS: "15000"
      }
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child?.once("exit", (code, signal) => resolve({ code, signal }));
    });

    child.kill("SIGTERM");
    const result = await withTimeout(exited, 20_000, "server did not exit within 20s of SIGTERM");

    // Exiting on the signal itself means the default handler ran and nothing
    // was drained; a clean code 0 means our handler owned the shutdown.
    assert.equal(result.signal, null, `expected a handled exit, got signal ${result.signal}. Output:\n${output}`);
    assert.equal(result.code, 0, `expected exit code 0, got ${result.code}. Output:\n${output}`);
    assert.match(output, /Received SIGTERM/);
    assert.match(output, /Shutdown complete/);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await removeTempDir(repoRoot);
  }
});

async function findFreePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function waitForHealth(baseUrl: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before becoming ready (code ${child.exitCode})`);
    }
    try {
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.get(
          new URL("/health", baseUrl),
          { headers: { Authorization: "Bearer shutdown-test-token" } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          }
        );
        req.on("error", reject);
      });
      if (statusCode >= 200 && statusCode < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server at ${baseUrl} never became ready`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref();
    })
  ]);
}
