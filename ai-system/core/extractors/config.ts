import type { GeneratedFile, ReviewIssue, TaskContract } from "../../types.js";
import { type ContractExtractor, type TaskRequirement } from "./base.js";

export class ConfigExtractor implements ContractExtractor {
  readonly domain = "config";

  detectRequirements(_task: string): TaskRequirement[] {
    // Current monolithic implementation doesn't have specific config requirements beyond security/tests
    return [];
  }

  validateCoverage(_contracts: TaskContract[], _files: GeneratedFile[]): ReviewIssue[] {
    return [];
  }
}
