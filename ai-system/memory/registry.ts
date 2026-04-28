import { LocalFileMemoryAdapter } from "./local-file.js";
import { OpenMemoryAdapter } from "./openmemory.js";
import type { Logger, MemoryAdapter, RulesConfig } from "../types.js";

export function createMemoryAdapter({
  repoRoot,
  rules,
  logger
}: {
  repoRoot: string;
  rules: RulesConfig;
  logger?: Logger;
}): MemoryAdapter {
  const config = rules.memory ?? {};

  if (config.enabled === false) {
    return new NoopMemoryAdapter();
  }

  switch (config.backend) {
    case "openmemory":
      return new OpenMemoryAdapter({ repoRoot, config, logger });
    case "local-file":
    default:
      return new LocalFileMemoryAdapter({ repoRoot, config, logger });
  }
}

class NoopMemoryAdapter implements MemoryAdapter {
  id: string;

  constructor() {
    this.id = "disabled";
  }

  async searchRelevant() {
    return [];
  }

  formatForPrompt() {
    return "";
  }

  async storeRunSummary() {
    return false;
  }
}
