import type { CliCommand, TaskRunOptions } from "../types.js";
import { loadWorkerRuntimeConfig } from "../../worker/worker-config.js";
import { runWorkerRuntime } from "../../worker/worker-runtime.js";

export async function handleWorkerCommand(
  command: CliCommand,
  options: TaskRunOptions
): Promise<boolean> {
  if (command.kind !== "worker-start") {
    return false;
  }

  const config = loadWorkerRuntimeConfig({
    cwd: options.cwd,
    serverUrl: command.serverUrl,
    workerToken: command.workerToken,
    workerName: command.workerName,
    labels: command.workerLabels,
    workspaceRoots: command.workspaceRoots,
    heartbeatIntervalMs: command.heartbeatIntervalMs,
    pollIntervalMs: command.pollIntervalMs,
    once: command.once
  });

  const abortController = new AbortController();
  const onSignal = () => abortController.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    console.log(`Worker starting: ${config.workerName}`);
    console.log(`- server: ${config.serverUrl}`);
    console.log(`- workspace roots: ${config.workspaceRoots.join(", ")}`);
    console.log(`- labels: ${config.labels.length > 0 ? config.labels.join(", ") : "(none)"}`);
    console.log(`- heartbeat interval: ${config.heartbeatIntervalMs}ms`);
    console.log(`- poll interval: ${config.pollIntervalMs}ms`);
    console.log(`- once: ${config.once}`);

    const summary = await runWorkerRuntime(config, {
      signal: abortController.signal
    });

    console.log(`Worker stopped: ${summary.worker.id}`);
    console.log(`- claimed: ${summary.claimedJobs}`);
    console.log(`- completed: ${summary.completedJobs}`);
    console.log(`- failed: ${summary.failedJobs}`);
    console.log(`- uploaded log lines: ${summary.uploadedLogLines}`);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  return true;
}
