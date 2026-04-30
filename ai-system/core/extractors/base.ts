import type { GeneratedFile, ReviewIssue, TaskContract } from "../../types.js";

export interface TaskRequirement {
  id: string;
  note: string;
  description: string;
  suggestedFix: string;
  severity?: TaskContract["severity"];
  checkStrategy?: TaskContract["checkStrategy"];
  targetPaths?: string[];
}

/**
 * Interface for domain-specific task contract extractors.
 */
export interface ContractExtractor {
  /**
   * The domain this extractor covers (e.g., 'ui', 'api', 'security').
   */
  readonly domain: string;

  /**
   * Detects domain-specific requirements from task text.
   */
  detectRequirements(task: string): TaskRequirement[];

  /**
   * Validates generated files against domain-specific contracts.
   * Returns issues if any requirements are not met.
   */
  validateCoverage(contracts: TaskContract[], files: GeneratedFile[]): ReviewIssue[];
}

export function requirementIssue(path: string, description: string, suggestedFix: string): ReviewIssue {
  return {
    severity: "medium",
    category: "requirement",
    path,
    description,
    suggestedFix
  };
}

export function normalizeTask(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
