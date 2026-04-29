import type { GeneratedFile, PlanResult, ReviewIssue, TaskContract } from "../types.js";

interface TaskRequirement {
  id: string;
  note: string;
  description: string;
  suggestedFix: string;
  severity?: TaskContract["severity"];
  checkStrategy?: TaskContract["checkStrategy"];
  targetPaths?: string[];
}

const EVENT_FEED_APP_PATH = "dashboard/src/App.tsx";

export function enhancePlanForTaskRequirements(task: string, plan: PlanResult): PlanResult {
  const requirements = detectTaskRequirements(task);
  if (requirements.length === 0) {
    return plan;
  }

  const readFiles = unique([
    ...plan.readFiles,
    ...(isEventFeedFilterTask(task) && !plan.readFiles.includes(EVENT_FEED_APP_PATH) ? [EVENT_FEED_APP_PATH] : [])
  ]);
  const writeTargets = unique([
    ...plan.writeTargets,
    ...(isEventFeedFilterTask(task) && readFiles.includes(EVENT_FEED_APP_PATH) ? [EVENT_FEED_APP_PATH] : [])
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
    suggestedFix: requirement.suggestedFix
  }));
}

export function validateTaskContractCoverage(contracts: TaskContract[], files: GeneratedFile[]): ReviewIssue[] {
  const supportedIds = new Set([
    "event-feed-filter-no-horizontal-scroll",
    "event-feed-filter-header-then-controls",
    "event-feed-filter-counts"
  ]);
  if (!contracts.some((contract) => supportedIds.has(contract.id))) {
    return [];
  }

  const issues: ReviewIssue[] = [];
  const candidates = files.filter((file) => isRelevantEventFeedFile(file.path));
  if (candidates.length === 0) {
    return issues;
  }

  for (const file of candidates) {
    if (contracts.some((contract) => contract.id === "event-feed-filter-no-horizontal-scroll")
      && hasHorizontalScrollRisk(file.content)
      && !hasWrappingFilterLayout(file.content)) {
      issues.push(requirementIssue(
        file.path,
        "Event Feed filter still appears to rely on horizontal scrolling instead of a wrapping or grid layout.",
        "Replace horizontal overflow/nowrap filter rows with flex-wrap or a responsive grid so filter controls never require sideways scrolling."
      ));
    }

    if (contracts.some((contract) => contract.id === "event-feed-filter-counts") && !hasPerFilterCount(file.content)) {
      issues.push(requirementIssue(
        file.path,
        "The task asks for a job count beside each filter label, but the generated filter UI does not expose per-filter counts.",
        "Compute counts per filter/status and render the count inside each filter option next to its label."
      ));
    }

    if (contracts.some((contract) => contract.id === "event-feed-filter-header-then-controls") && !hasHeaderThenFilterStructure(file.content)) {
      issues.push(requirementIssue(
        file.path,
        "The task asks for a clearer Event Feed filter structure with a title/header above and filters below.",
        "Render the Event Feed title/summary in a header row and place the filter controls in a separate row underneath."
      ));
    }
  }

  return issues;
}

function detectTaskRequirements(task: string): TaskRequirement[] {
  const requirements: TaskRequirement[] = [];

  if (isEventFeedFilterTask(task)) {
    if (asksNoHorizontalScroll(task)) {
      requirements.push({
        id: "event-feed-filter-no-horizontal-scroll",
        note: "Requirement: Event Feed filter controls must not require horizontal scrolling; prefer flex-wrap or a responsive grid.",
        description: "Event Feed filter controls must not require horizontal scrolling.",
        suggestedFix: "Replace horizontal overflow/nowrap filter rows with flex-wrap or a responsive grid."
      });
    }
    if (asksHeaderThenFilters(task)) {
      requirements.push({
        id: "event-feed-filter-header-then-controls",
        note: "Requirement: put the Event Feed title/header area above and the filter controls below it.",
        description: "Event Feed title/header must be visually above the filter controls.",
        suggestedFix: "Render the Event Feed title/summary in a header row and place filter controls underneath."
      });
    }
    if (asksFilterCountBesideLabel(task)) {
      requirements.push({
        id: "event-feed-filter-counts",
        note: "Requirement: show the job count beside each filter label, not only a single global count.",
        description: "Each filter label must show its matching job count.",
        suggestedFix: "Compute counts per filter/status and render the count next to each filter label."
      });
    }
  }

  if (asksForResponsiveUILayout(task)) {
    requirements.push({
      id: "ui-layout-responsive-no-overflow",
      note: "Requirement: UI layout must remain responsive and avoid horizontal overflow across supported viewports.",
      description: "UI layout must remain responsive without horizontal overflow.",
      suggestedFix: "Use wrapping, responsive grid tracks, and bounded widths for controls and repeated items.",
      targetPaths: ["dashboard/src"]
    });
  }

  if (asksToPreserveApiOrSchema(task)) {
    requirements.push({
      id: "api-schema-preserve-existing-contract",
      note: "Requirement: preserve existing API/schema shape unless the task explicitly asks for a breaking change.",
      description: "Existing API or schema output must remain backward compatible.",
      suggestedFix: "Update implementation behind the existing response shape or add an explicit migration/test for any schema change.",
      severity: "high",
      targetPaths: ["ai-system", "dashboard/src"]
    });
  }

  if (touchesRiskyAreaNeedingTests(task)) {
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

  if (touchesSecurityOrDependencyPolicy(task)) {
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

function isEventFeedFilterTask(task: string): boolean {
  const normalized = normalize(task);
  return /event\s+fe(?:e|a)d/.test(normalized) && normalized.includes("filter");
}

function asksNoHorizontalScroll(task: string): boolean {
  const normalized = normalize(task);
  return normalized.includes("scroll ngang") || normalized.includes("horizontal scroll") || normalized.includes("overflow-x");
}

function asksFilterCountBesideLabel(task: string): boolean {
  const normalized = normalize(task);
  return normalized.includes("count") && (normalized.includes("label") || normalized.includes("filter"));
}

function asksHeaderThenFilters(task: string): boolean {
  const normalized = normalize(task);
  return normalized.includes("title") || normalized.includes("tilte") || normalized.includes("bên trên") || normalized.includes("above");
}

function asksForResponsiveUILayout(task: string): boolean {
  const normalized = normalize(task);
  return /\b(ui|giao diện|layout|responsive|mobile|desktop|viewport)\b/.test(normalized)
    && (normalized.includes("scroll ngang") || normalized.includes("horizontal") || normalized.includes("responsive") || normalized.includes("đẹp"));
}

function asksToPreserveApiOrSchema(task: string): boolean {
  const normalized = normalize(task);
  return /(api|schema|response|payload|contract|database|db|migration)/.test(normalized)
    && /(preserve|compatible|compatibility|không đổi|giu nguyen|giữ nguyên|backward)/.test(normalized);
}

function touchesRiskyAreaNeedingTests(task: string): boolean {
  const normalized = normalize(task);
  return /(auth|authentication|authorization|login|payment|billing|migration|queue|approval|config|server|orchestrator)/.test(normalized)
    && /(fix|change|update|sửa|chỉnh|implement|add|thêm|xử lý)/.test(normalized);
}

function touchesSecurityOrDependencyPolicy(task: string): boolean {
  const normalized = normalize(task);
  return /(security|secure|secret|token|permission|dependency|dependencies|package|audit|vulnerability|pnpm-lock|lockfile)/.test(normalized);
}

function isRelevantEventFeedFile(filePath: string): boolean {
  return filePath === EVENT_FEED_APP_PATH || /event[-_/]?feed/i.test(filePath);
}

function hasHorizontalScrollRisk(content: string): boolean {
  return /overflow-x-(auto|scroll)|whitespace-nowrap|flex-nowrap/.test(content);
}

function hasWrappingFilterLayout(content: string): boolean {
  return /flex-wrap|grid-cols-|auto-fit|auto-fill|minmax\(/.test(content);
}

function hasPerFilterCount(content: string): boolean {
  return /(status|filter|job)Counts?\s*\[[^\]]*filter[^\]]*\]/.test(content)
    || /(status|filter|job)Counts?\s*\.\s*get\([^)]*filter/.test(content)
    || /filter\s*=>[\s\S]{0,120}(count|total)[\s\S]{0,120}<span/i.test(content);
}

function hasHeaderThenFilterStructure(content: string): boolean {
  return /Event Feed/i.test(content) && /Filter by status|filter/i.test(content) && /flex-wrap|grid-cols-|auto-fit|auto-fill/.test(content);
}

function requirementIssue(path: string, description: string, suggestedFix: string): ReviewIssue {
  return {
    severity: "medium",
    category: "requirement",
    path,
    description,
    suggestedFix
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function mergeContracts(existing: TaskContract[], next: TaskContract[]): TaskContract[] {
  const byId = new Map<string, TaskContract>();
  for (const contract of existing) {
    byId.set(contract.id, contract);
  }
  for (const contract of next) {
    byId.set(contract.id, contract);
  }
  return [...byId.values()];
}
