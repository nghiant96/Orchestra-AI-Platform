import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTaskContracts,
  enhancePlanForTaskRequirements,
  validateTaskContractCoverage,
  validateTaskRequirementCoverage
} from "../ai-system/core/task-requirements.js";
import type { GeneratedFile, PlanResult } from "../ai-system/types.js";

const eventFeedTask = "Ở phần filter event fead tôi không muốn nó bị scroll ngang. Có thể là thành 2 tilte bên trên filter bên dưới. Đồng thời thêm cho tôi count job bên cạnh label";

describe("task requirement guards", () => {
  it("adds Event Feed App.tsx as an allowed write target and records checklist notes", () => {
    const plan: PlanResult = {
      prompt: eventFeedTask,
      readFiles: ["dashboard/src/App.tsx"],
      writeTargets: [],
      notes: []
    };

    const enhanced = enhancePlanForTaskRequirements(eventFeedTask, plan);

    assert.ok(enhanced.writeTargets.includes("dashboard/src/App.tsx"));
    assert.ok(enhanced.notes.some((note) => note.includes("horizontal scrolling")));
    assert.ok(enhanced.notes.some((note) => note.includes("job count beside each filter label")));
    assert.deepEqual(enhanced.contracts?.map((contract) => contract.id), [
      "event-feed-filter-no-horizontal-scroll",
      "event-feed-filter-header-then-controls",
      "event-feed-filter-counts"
    ]);
  });

  it("flags Event Feed filter output that still depends on horizontal scrolling", () => {
    const files: GeneratedFile[] = [
      {
        path: "dashboard/src/App.tsx",
        content: `
          export function App() {
            return <div className="overflow-x-auto whitespace-nowrap">
              <button>all</button>
            </div>;
          }
        `
      }
    ];

    const issues = validateTaskRequirementCoverage(eventFeedTask, files);

    assert.ok(issues.some((issue) => issue.description.includes("horizontal scrolling")));
  });

  it("flags global-only job counts when the task asks for counts beside labels", () => {
    const files: GeneratedFile[] = [
      {
        path: "dashboard/src/App.tsx",
        content: `
          export function App() {
            return <section>
              <h2>Event Feed</h2>
              <p>{filteredJobs.length} jobs</p>
              <div className="flex flex-wrap">{statusFilters.map((filter) => <button>{filter}</button>)}</div>
            </section>;
          }
        `
      }
    ];

    const issues = validateTaskRequirementCoverage(eventFeedTask, files);

    assert.ok(issues.some((issue) => issue.description.includes("job count beside each filter label")));
  });

  it("accepts wrapped Event Feed filters with per-filter counts and header structure", () => {
    const files: GeneratedFile[] = [
      {
        path: "dashboard/src/App.tsx",
        content: `
          export function App() {
            const statusCounts = { all: 3, completed: 2 };
            return <section>
              <div><h2>Event Feed</h2><p>Recent jobs</p></div>
              <div className="flex flex-wrap">
                {statusFilters.map((filter) => (
                  <button>
                    <span>{filter}</span>
                    <span>{statusCounts[filter] || 0}</span>
                  </button>
                ))}
              </div>
            </section>;
          }
        `
      }
    ];

    const issues = validateTaskRequirementCoverage(eventFeedTask, files);

    assert.deepEqual(issues, []);
  });

  it("validates migrated TaskContract objects without reparsing task text", () => {
    const contracts = buildTaskContracts(eventFeedTask);
    const files: GeneratedFile[] = [
      {
        path: "dashboard/src/App.tsx",
        content: `
          export function App() {
            return <section>
              <h2>Event Feed</h2>
              <div className="flex flex-wrap">{statusFilters.map((filter) => <button>{filter}</button>)}</div>
            </section>;
          }
        `
      }
    ];

    const issues = validateTaskContractCoverage(contracts, files);

    assert.ok(issues.some((issue) => issue.description.includes("job count beside each filter label")));
  });
});
