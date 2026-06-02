import { resolveStoreMode, type OrchestraStoreMode } from "./store-mode.js";

export interface OrchestraStoreCapabilities {
  durable: boolean;
  migrations: boolean;
  multiProcess: boolean;
}

export interface OrchestraStoreDescriptor {
  mode: OrchestraStoreMode;
  capabilities: OrchestraStoreCapabilities;
}

export function resolveOrchestraStoreDescriptor(): OrchestraStoreDescriptor {
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
