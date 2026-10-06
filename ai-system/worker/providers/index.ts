import { CodexProvider } from "./codex-provider.js";
import type { ProviderUsageRecorder } from "../provider-usage.js";
import type { WorkerProviderAdapter, WorkerProviderId } from "./provider-adapter.js";

export function resolveWorkerProvider(
  id = process.env.ORCHESTRA_WORKER_PROVIDER || "codex",
  options: { codexCommand?: string; usage?: ProviderUsageRecorder } = {}
): WorkerProviderAdapter {
  const normalized = id.trim().toLowerCase() as WorkerProviderId;
  switch (normalized) {
    case "codex":
      return new CodexProvider(options.codexCommand, options.usage);
    default:
      throw new Error(`Unsupported worker provider: ${id}`);
  }
}

export type { WorkerProviderAdapter, WorkerProviderExecutionInput, WorkerProviderExecutionResult, WorkerProviderId } from "./provider-adapter.js";
