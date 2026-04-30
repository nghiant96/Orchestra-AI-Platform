import type { GeneratedFile, ReviewIssue, TaskContract } from "../../types.js";
import { type ContractExtractor, type TaskRequirement, normalizeTask } from "./base.js";

export class TestsExtractor implements ContractExtractor {
  readonly domain = "tests";

  detectRequirements(task: string): TaskRequirement[] {
    const requirements: TaskRequirement[] = [];
    const normalized = normalizeTask(task);

    if (touchesRiskyAreaNeedingTests(normalized)) {
      requirements.push({
        id: "risky-change-requires-focused-tests",
        note: "Requirement: risky changes must include or run focused tests for the affected behavior.",
        description: "Risky changes require focused test coverage.",
        suggestedFix: "Add or run targeted tests covering auth, payment, migration, queue lifecycle, or config behavior touched by the task.",
        severity: "high",
        checkStrategy: "tool",
        targetPaths: ["tests"]
      });
    }

    return requirements;
  }

  validateCoverage(_contracts: TaskContract[], _files: GeneratedFile[]): ReviewIssue[] {
    return [];
  }
}

function touchesRiskyAreaNeedingTests(normalized: string): boolean {
  return /(auth|authentication|authorization|login|payment|billing|migration|queue|approval|config|server|orchestrator)/.test(normalized)
    && /(fix|change|update|sửa|chỉnh|implement|add|thêm|xử lý)/.test(normalized);
}
