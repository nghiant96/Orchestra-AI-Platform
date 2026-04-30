import type { GeneratedFile, ReviewIssue, TaskContract } from "../../types.js";
import { type ContractExtractor, type TaskRequirement } from "./base.js";

export class DataExtractor implements ContractExtractor {
  readonly domain = "data";

  detectRequirements(_task: string): TaskRequirement[] {
    // Current monolithic implementation doesn't have specific data requirements beyond API
    return [];
  }

  validateCoverage(_contracts: TaskContract[], _files: GeneratedFile[]): ReviewIssue[] {
    return [];
  }
}
