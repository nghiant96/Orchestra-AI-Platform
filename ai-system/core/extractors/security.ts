import type { GeneratedFile, ReviewIssue, TaskContract } from "../../types.js";
import { type ContractExtractor, type TaskRequirement, normalizeTask } from "./base.js";

export class SecurityExtractor implements ContractExtractor {
  readonly domain = "security";

  detectRequirements(task: string): TaskRequirement[] {
    const requirements: TaskRequirement[] = [];
    const normalized = normalizeTask(task);

    if (touchesSecurityOrDependencyPolicy(normalized)) {
      requirements.push({
        id: "security-dependency-strict-review",
        note: "Requirement: security or dependency changes require strict review and audit-oriented checks.",
        description: "Security or dependency changes require strict review and audit checks.",
        suggestedFix: "Run dependency audit or security-focused validation and document any risk introduced by the change.",
        severity: "high",
        checkStrategy: "tool",
        targetPaths: ["package.json", "pnpm-lock.yaml", ".ai-system.json"]
      });
    }

    return requirements;
  }

  validateCoverage(_contracts: TaskContract[], _files: GeneratedFile[]): ReviewIssue[] {
    return [];
  }
}

function touchesSecurityOrDependencyPolicy(normalized: string): boolean {
  return /(security|secure|secret|token|permission|dependency|dependencies|package|audit|vulnerability|pnpm-lock|lockfile)/.test(normalized);
}
