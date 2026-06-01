import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { loadWorkerRuntimeConfig } from "../ai-system/worker/worker-config.js";
import { runWorkerRuntime } from "../ai-system/worker/worker-runtime.js";

const token = process.env.AI_SYSTEM_SERVER_TOKEN || "smoke-server-token";
const workerToken = process.env.ORCHESTRA_WORKER_TOKEN || "smoke-worker-token";

async function main(): Promise<void> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orchestra-smoke-"));
  const previousBackend = process.env.ORCHESTRA_EXECUTION_BACKEND;
  const previousWorkerToken = process.env.ORCHESTRA_WORKER_TOKEN;
  const previousProvider = process.env.ORCHESTRA_WORKER_PROVIDER;
  process.env.ORCHESTRA_EXECUTION_BACKEND = "worker";
  process.env.ORCHESTRA_WORKER_TOKEN = workerToken;
  process.env.ORCHESTRA_WORKER_PROVIDER = "dummy";
  const server = createAiSystemServer({
    defaultCwd: repoRoot,
    authToken: token,
    allowedWorkdirs: [repoRoot],
    logger: silentLogger(),
    runner: async () => ({ ok: true } as any)
  });

  try {
    const baseUrl = await listen(server);
    const created = await requestJson(baseUrl, "POST", "/jobs", {
      task: "worker:write-file demo.txt::hello",
      cwd: repoRoot,
      dryRun: true
    }, {
      Authorization: `Bearer ${token}`,
      "x-ai-system-role": "operator",
      "x-ai-system-actor": "orchestra-smoke"
    });

    const summary = await runWorkerRuntime(loadWorkerRuntimeConfig({
      cwd: repoRoot,
      serverUrl: baseUrl,
      workerToken,
      workerName: "orchestra-smoke-worker",
      workspaceRoots: [repoRoot],
      provider: "dummy",
      once: true,
      heartbeatIntervalMs: 100,
      pollIntervalMs: 100
    }), { logger: silentLogger() });

    const job = await requestJson(baseUrl, "GET", `/jobs/${created.jobId}`, undefined, {
      Authorization: `Bearer ${token}`
    });
    const wroteFile = await fs.stat(path.join(repoRoot, "demo.txt")).then(() => true, () => false);
    if (summary.claimedJobs !== 1 || summary.completedJobs !== 1 || job.status !== "completed" || wroteFile) {
      throw new Error(`Smoke failed: claimed=${summary.claimedJobs} completed=${summary.completedJobs} status=${job.status} wroteFile=${wroteFile}`);
    }
    console.log(`orchestra smoke passed: ${created.jobId}`);
  } finally {
    restoreEnvValue("ORCHESTRA_EXECUTION_BACKEND", previousBackend);
    restoreEnvValue("ORCHESTRA_WORKER_TOKEN", previousWorkerToken);
    restoreEnvValue("ORCHESTRA_WORKER_PROVIDER", previousProvider);
    await closeServer(server);
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function requestJson(baseUrl: string, method: string, pathname: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
  const rawBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(rawBody ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: rawBody
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }
  return parsed;
}

function silentLogger() {
  return {
    step() {},
    info() {},
    warn() {},
    error() {},
    success() {}
  };
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
