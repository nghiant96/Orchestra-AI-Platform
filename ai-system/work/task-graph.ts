import type { ExecutionGraph, ExecutionGraphEdge, ExecutionGraphNode, WorkItem } from "./work-item.js";

export function buildTaskGraph(workItem: Pick<WorkItem, "type" | "expectedOutput" | "risk">): ExecutionGraph {
  const template = workItem.type === "review"
    ? ["inspect", "check", "review"]
    : workItem.type === "docs"
      ? ["inspect", "implement", "check"]
      : ["inspect", "test", "implement", "check", "review"];

  const nodes: ExecutionGraphNode[] = template.map((kind, index) => ({
    id: `${kind}-${index + 1}`,
    kind: kind as ExecutionGraphNode["kind"],
    title: defaultTitle(kind, workItem.type, workItem.expectedOutput),
    goal: defaultGoal(kind, workItem.type),
    status: "pending",
    dependsOn: index === 0 ? [] : [`${template[index - 1]}-${index}`]
  }));

  if (workItem.expectedOutput === "pull_request") {
    nodes.push({
      id: "pr-1",
      kind: "pr",
      title: "Prepare PR",
      goal: "Compile evidence and prepare a reviewable pull request.",
      status: "pending",
      dependsOn: [nodes[nodes.length - 1]?.id || "review-1"]
    });
  }

  if (workItem.risk === "high" || workItem.risk === "blocked") {
    nodes.push({
      id: "ci_fix-1",
      kind: "ci_fix",
      title: "Repair CI",
      goal: "Resolve any failing verification or integration checks.",
      status: "pending",
      dependsOn: [nodes[nodes.length - 1]?.id || "review-1"]
    });
  }

  const edges: ExecutionGraphEdge[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    edges.push({ from: nodes[index - 1].id, to: nodes[index].id, kind: "dependency" });
  }

  return { nodes, edges };
}

function defaultTitle(kind: string, type: string, expectedOutput: string): string {
  if (kind === "inspect") return "Inspect the task";
  if (kind === "test") return "Reproduce or verify the change";
  if (kind === "implement") return type === "docs" ? "Update documentation" : "Implement the change";
  if (kind === "check") return "Run checks";
  if (kind === "review") return "Review the result";
  if (kind === "commit") return "Prepare commit";
  if (kind === "pr") return expectedOutput === "pull_request" ? "Prepare pull request" : "Prepare PR";
  if (kind === "ci_fix") return "Fix CI";
  return "Execute step";
}

function defaultGoal(kind: string, type: string): string {
  if (kind === "inspect") return "Understand scope, risk, and relevant files.";
  if (kind === "test") return "Establish the failing behavior or verify the baseline.";
  if (kind === "implement") return type === "docs" ? "Edit docs with the smallest safe change." : "Apply the requested change.";
  if (kind === "check") return "Run typecheck, lint, or targeted tests.";
  if (kind === "review") return "Validate evidence and surface residual risks.";
  if (kind === "commit") return "Package the work into a reviewable commit.";
  if (kind === "pr") return "Package the work into a pull request.";
  if (kind === "ci_fix") return "Respond to CI failures with targeted fixes.";
  return "Complete the step.";
}
