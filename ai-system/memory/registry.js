import { LocalFileMemoryAdapter } from "./local-file.js";
import { OpenMemoryAdapter } from "./openmemory.js";

export function createMemoryAdapter({ repoRoot, rules, logger }) {
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

class NoopMemoryAdapter {
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
