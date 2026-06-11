import type { ContextCandidate } from "./context-builder.js";
import type { MemoryNamespace } from "../memory/memory-namespace.js";

export interface SemanticContextProvider {
  search(input: {
    query: string;
    repoRoot: string;
    namespace: MemoryNamespace;
    limit: number;
  }): Promise<ContextCandidate[]>;
}

export function createNoopSemanticContextProvider(): SemanticContextProvider {
  return {
    async search() {
      return [];
    }
  };
}
