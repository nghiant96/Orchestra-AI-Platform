import { CodexProvider } from "./codex-provider.js";
export function resolveWorkerProvider(id = process.env.ORCHESTRA_WORKER_PROVIDER || "codex", options = {}) {
    const normalized = id.trim().toLowerCase();
    switch (normalized) {
        case "codex":
            return new CodexProvider(options.codexCommand);
        default:
            throw new Error(`Unsupported worker provider: ${id}`);
    }
}
