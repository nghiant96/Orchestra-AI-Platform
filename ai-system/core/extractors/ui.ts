import type { GeneratedFile, ReviewIssue, TaskContract } from "../../types.js";
import { type ContractExtractor, type TaskRequirement, normalizeTask, requirementIssue } from "./base.js";

const EVENT_FEED_APP_PATH = "dashboard/src/App.tsx";

export class UIExtractor implements ContractExtractor {
  readonly domain = "ui";

  detectRequirements(task: string): TaskRequirement[] {
    const requirements: TaskRequirement[] = [];
    const normalized = normalizeTask(task);

    if (isEventFeedFilterTask(normalized)) {
      if (asksNoHorizontalScroll(normalized)) {
        requirements.push({
          id: "event-feed-filter-no-horizontal-scroll",
          note: "Requirement: Event Feed filter controls must not require horizontal scrolling; prefer flex-wrap or a responsive grid.",
          description: "Event Feed filter controls must not require horizontal scrolling.",
          suggestedFix: "Replace horizontal overflow/nowrap filter rows with flex-wrap or a responsive grid."
        });
      }
      if (asksHeaderThenFilters(normalized)) {
        requirements.push({
          id: "event-feed-filter-header-then-controls",
          note: "Requirement: put the Event Feed title/header area above and the filter controls below it.",
          description: "Event Feed title/header must be visually above the filter controls.",
          suggestedFix: "Render the Event Feed title/summary in a header row and place filter controls underneath."
        });
      }
      if (asksFilterCountBesideLabel(normalized)) {
        requirements.push({
          id: "event-feed-filter-counts",
          note: "Requirement: show the job count beside each filter label, not only a single global count.",
          description: "Each filter label must show its matching job count.",
          suggestedFix: "Compute counts per filter/status and render the count next to each filter label."
        });
      }
    }

    if (asksForResponsiveUILayout(normalized)) {
      requirements.push({
        id: "ui-layout-responsive-no-overflow",
        note: "Requirement: UI layout must remain responsive and avoid horizontal overflow across supported viewports.",
        description: "UI layout must remain responsive without horizontal overflow.",
        suggestedFix: "Use wrapping, responsive grid tracks, and bounded widths for controls and repeated items.",
        targetPaths: ["dashboard/src"]
      });
    }

    return requirements;
  }

  validateCoverage(contracts: TaskContract[], files: GeneratedFile[]): ReviewIssue[] {
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
        issues.push({
          ...requirementIssue(
            file.path,
            "Event Feed filter still appears to rely on horizontal scrolling instead of a wrapping or grid layout.",
            "Replace horizontal overflow/nowrap filter rows with flex-wrap or a responsive grid so filter controls never require sideways scrolling."
          ),
          verificationCommand: "npm run lint && dashboard:build",
          affectedFiles: [file.path]
        });
      }

      if (contracts.some((contract) => contract.id === "event-feed-filter-counts") && !hasPerFilterCount(file.content)) {
        issues.push({
          ...requirementIssue(
            file.path,
            "The task asks for a job count beside each filter label, but the generated filter UI does not expose per-filter counts.",
            "Compute counts per filter/status and render the count inside each filter option next to its label."
          ),
          verificationCommand: "npm run lint",
          affectedFiles: [file.path]
        });
      }

      if (contracts.some((contract) => contract.id === "event-feed-filter-header-then-controls") && !hasHeaderThenFilterStructure(file.content)) {
        issues.push({
          ...requirementIssue(
            file.path,
            "The task asks for a clearer Event Feed filter structure with a title/header above and filters below.",
            "Render the Event Feed title/summary in a header row and place the filter controls in a separate row underneath."
          ),
          verificationCommand: "npm run lint",
          affectedFiles: [file.path]
        });
      }
    }

    return issues;
  }
}

function isEventFeedFilterTask(normalized: string): boolean {
  return /event\s+fe(?:e|a)d/.test(normalized) && normalized.includes("filter");
}

function asksNoHorizontalScroll(normalized: string): boolean {
  return normalized.includes("scroll ngang") || normalized.includes("horizontal scroll") || normalized.includes("overflow-x");
}

function asksFilterCountBesideLabel(normalized: string): boolean {
  return normalized.includes("count") && (normalized.includes("label") || normalized.includes("filter"));
}

function asksHeaderThenFilters(normalized: string): boolean {
  return normalized.includes("title") || normalized.includes("tilte") || normalized.includes("bên trên") || normalized.includes("above");
}

function asksForResponsiveUILayout(normalized: string): boolean {
  return /\b(ui|giao diện|layout|responsive|mobile|desktop|viewport)\b/.test(normalized)
    && (normalized.includes("scroll ngang") || normalized.includes("horizontal") || normalized.includes("responsive") || normalized.includes("đẹp"));
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
