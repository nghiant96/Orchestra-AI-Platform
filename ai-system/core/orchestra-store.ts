import { resolveStoreMode, type OrchestraStoreMode } from "./store-mode.js";

export interface OrchestraStoreCapabilities {
  durable: boolean;
  migrations: boolean;
  multiProcess: boolean;
}

export interface OrchestraStoreDescriptor {
  mode: OrchestraStoreMode;
  implemented: boolean;
  capabilities: OrchestraStoreCapabilities;
  warning?: string;
}

export function resolveOrchestraStoreDescriptor(): OrchestraStoreDescriptor {
  const mode = resolveStoreMode();
  if (mode === "file") {
    return {
      mode,
      implemented: true,
      capabilities: {
        durable: false,
        migrations: false,
        multiProcess: false
      }
    };
  }

  return {
    mode,
    implemented: false,
    capabilities: {
      durable: false,
      migrations: false,
      multiProcess: false
    },
    warning: mode === "sqlite"
      ? "SQLite store is reserved but not implemented yet."
      : "Postgres store is reserved but not implemented yet."
  };
}
