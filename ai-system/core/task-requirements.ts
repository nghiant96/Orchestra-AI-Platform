import type { GeneratedFile, PlanResult, ReviewIssue } from "../types.js";

interface TaskRequirement {
  id: string;
  note: string;
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

  return {
    ...plan,
    readFiles,
    writeTargets,
    notes
  };
}

export function validateTaskRequirementCoverage(task: string, files: GeneratedFile[]): ReviewIssue[] {
  if (!isEventFeedFilterTask(task)) {
    return [];
  }

  const issues: ReviewIssue[] = [];
  const candidates = files.filter((file) => isRelevantEventFeedFile(file.path));
  if (candidates.length === 0) {
    return issues;
  }

  for (const file of candidates) {
    if (asksNoHorizontalScroll(task) && hasHorizontalScrollRisk(file.content) && !hasWrappingFilterLayout(file.content)) {
      issues.push(requirementIssue(
        file.path,
        "Event Feed filter still appears to rely on horizontal scrolling instead of a wrapping or grid layout.",
        "Replace horizontal overflow/nowrap filter rows with flex-wrap or a responsive grid so filter controls never require sideways scrolling."
      ));
    }

    if (asksFilterCountBesideLabel(task) && !hasPerFilterCount(file.content)) {
      issues.push(requirementIssue(
        file.path,
        "The task asks for a job count beside each filter label, but the generated filter UI does not expose per-filter counts.",
        "Compute counts per filter/status and render the count inside each filter option next to its label."
      ));
    }

    if (asksHeaderThenFilters(task) && !hasHeaderThenFilterStructure(file.content)) {
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
  if (!isEventFeedFilterTask(task)) {
    return [];
  }

  const requirements: TaskRequirement[] = [];
  if (asksNoHorizontalScroll(task)) {
    requirements.push({
      id: "event-feed-filter-no-horizontal-scroll",
      note: "Requirement: Event Feed filter controls must not require horizontal scrolling; prefer flex-wrap or a responsive grid."
    });
  }
  if (asksHeaderThenFilters(task)) {
    requirements.push({
      id: "event-feed-filter-header-then-controls",
      note: "Requirement: put the Event Feed title/header area above and the filter controls below it."
    });
  }
  if (asksFilterCountBesideLabel(task)) {
    requirements.push({
      id: "event-feed-filter-counts",
      note: "Requirement: show the job count beside each filter label, not only a single global count."
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
