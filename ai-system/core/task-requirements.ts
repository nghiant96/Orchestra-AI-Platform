import type { GeneratedFile, PlanResult, ReviewIssue, TaskContract } from "../types.js";
import type { ContractExtractor, TaskRequirement } from "./extractors/base.js";
import { UIExtractor } from "./extractors/ui.js";
import { APIExtractor } from "./extractors/api.js";
import { SecurityExtractor } from "./extractors/security.js";
import { TestsExtractor } from "./extractors/tests.js";
import { DataExtractor } from "./extractors/data.js";
import { ConfigExtractor } from "./extractors/config.js";

const EVENT_FEED_APP_PATH = "dashboard/src/App.tsx";

/**
 * Registry for task contract extractors.
 */
export class ExtractorRegistry {
  private extractors: ContractExtractor[] = [];

  register(extractor: ContractExtractor): void {
    // Avoid duplicates by domain
    if (this.extractors.some(e => e.domain === extractor.domain)) {
      return;
    }
    this.extractors.push(extractor);
  }

  getExtractors(): ContractExtractor[] {
    return [...this.extractors];
  }
}

// Global registry instance
export const globalRegistry = new ExtractorRegistry();

// Register default extractors
globalRegistry.register(new UIExtractor());
globalRegistry.register(new APIExtractor());
globalRegistry.register(new SecurityExtractor());
globalRegistry.register(new TestsExtractor());
globalRegistry.register(new DataExtractor());
globalRegistry.register(new ConfigExtractor());

export function enhancePlanForTaskRequirements(task: string, plan: PlanResult): PlanResult {
  const requirements = detectTaskRequirements(task);
  if (requirements.length === 0) {
    return plan;
  }

  // Legacy specific behavior for Event Feed
  const isEventFeedFilter = /event\s+fe(?:e|a)d/.test(task.toLowerCase()) && task.toLowerCase().includes("filter");

  const readFiles = unique([
    ...plan.readFiles,
    ...(isEventFeedFilter && !plan.readFiles.includes(EVENT_FEED_APP_PATH) ? [EVENT_FEED_APP_PATH] : [])
  ]);
  const writeTargets = unique([
    ...plan.writeTargets,
    ...(isEventFeedFilter && readFiles.includes(EVENT_FEED_APP_PATH) ? [EVENT_FEED_APP_PATH] : [])
  ]);
  const notes = unique([...plan.notes, ...requirements.map((requirement) => requirement.note)]);
  const contracts = mergeContracts(plan.contracts ?? [], buildTaskContracts(task));

  return {
    ...plan,
    readFiles,
    writeTargets,
    notes,
    contracts
  };
}

export function validateTaskRequirementCoverage(task: string, files: GeneratedFile[]): ReviewIssue[] {
  return validateTaskContractCoverage(buildTaskContracts(task), files);
}

export function buildTaskContracts(task: string): TaskContract[] {
  return detectTaskRequirements(task).map((requirement) => ({
    id: requirement.id,
    description: requirement.description,
    severity: requirement.severity ?? "medium",
    status: "pending",
    checkStrategy: requirement.checkStrategy ?? "deterministic",
    targetPaths: requirement.targetPaths ?? [EVENT_FEED_APP_PATH],
    suggestedFix: requirement.suggestedFix,
    source: "deterministic"
  }));
}

export function validateTaskContractCoverage(contracts: TaskContract[], files: GeneratedFile[]): ReviewIssue[] {
  const allIssues: ReviewIssue[] = [];
  
  for (const extractor of globalRegistry.getExtractors()) {
    const issues = extractor.validateCoverage(contracts, files);
    allIssues.push(...issues);
  }

  return allIssues;
}

function detectTaskRequirements(task: string): TaskRequirement[] {
  const allRequirements: TaskRequirement[] = [];

  for (const extractor of globalRegistry.getExtractors()) {
    const requirements = extractor.detectRequirements(task);
    allRequirements.push(...requirements);
  }

  return allRequirements;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function mergeContracts(existing: TaskContract[], next: TaskContract[]): TaskContract[] {
  const byId = new Map<string, TaskContract>();
  for (const contract of existing) {
    byId.set(contract.id, { ...contract, source: contract.source ?? "llm" });
  }
  for (const contract of next) {
    // Deterministic contracts from 'next' will overwrite LLM suggested ones from 'existing'
    byId.set(contract.id, { ...contract, source: "deterministic" });
  }
  return [...byId.values()];
}
