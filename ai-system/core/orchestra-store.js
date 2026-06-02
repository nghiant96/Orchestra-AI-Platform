import { resolveStoreMode } from "./store-mode.js";
export function resolveOrchestraStoreDescriptor() {
    const mode = resolveStoreMode();
    return {
        mode,
        capabilities: {
            durable: mode !== "file",
            migrations: mode !== "file",
            multiProcess: mode !== "file"
        }
    };
}
