import type { ChecklistItem, ExecutionGraph, WorkItem } from "./work-item.js";

export function buildChecklist(workItem: Pick<WorkItem, "type" | "risk" | "expectedOutput">, graph: ExecutionGraph): ChecklistItem[] {
  const items: ChecklistItem[] = graph.nodes.map((node) => ({
    id: node.id,
    text: checklistText(node.kind),
    required: true,
    status: "todo"
  }));

  if (workItem.expectedOutput === "pull_request") {
    items.push({
      id: "pr-body",
      text: "Prepare a PR body grounded in evidence.",
      required: true,
      status: "todo"
    });
  }

  if (workItem.risk !== "low") {
    items.push({
      id: "full-suite",
      text: "Run the full relevant test suite.",
      required: true,
      status: "todo"
    });
  }

  return items;
}

export function validateChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items.map((item) => {
    if (item.required && item.status === "passed" && !item.evidence) {
      return { ...item, status: "failed" };
    }
    return item;
  });
}

function checklistText(kind: string): string {
  switch (kind) {
    case "inspect":
      return "Inspect scope and impact.";
    case "test":
      return "Reproduce or verify the baseline.";
    case "implement":
      return "Implement the requested change.";
    case "check":
      return "Run validation checks.";
    case "review":
      return "Review evidence and residual risk.";
    case "commit":
      return "Prepare a commit.";
    case "pr":
      return "Prepare a pull request.";
    case "ci_fix":
      return "Repair CI failures.";
    default:
      return "Complete the step.";
  }
}
