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

  if (mode === "sqlite") {
    return {
      mode,
      implemented: true,
      capabilities: {
        durable: true,
        migrations: true,
        multiProcess: true
      }
    };
  }

  return {
    mode,
    implemented: true,
    capabilities: {
      durable: true,
      migrations: true,
      multiProcess: true
    }
  };
}
