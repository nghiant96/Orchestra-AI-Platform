import type { WorkItem } from "../../work/work-item.js";

/**
 * Prints a detailed view of a single WorkItem.
 */
export function printWorkItem(workItem: WorkItem): void {
  console.log("");
  console.log(`Work Item: ${workItem.id}`);
  console.log(`- title:       ${workItem.title}`);
  console.log(`- project:     ${workItem.projectId}`);
  console.log(`- status:      ${workItem.status}`);
  console.log(`- risk:        ${workItem.risk}`);
  console.log(`- type:        ${workItem.type}`);
  console.log(`- source:      ${workItem.source}`);
  console.log(`- created:     ${workItem.createdAt}`);
  console.log(`- updated:     ${workItem.updatedAt}`);
  
  if (workItem.description) {
    console.log("- description:");
    console.log(workItem.description);
  }

  if (workItem.linkedRuns.length > 0) {
    console.log("- linked runs:");
    workItem.linkedRuns.forEach(runId => console.log(`  - ${runId}`));
  }

  if (workItem.assessment) {
    console.log("- assessment:");
    console.log(`  - complexity: ${workItem.assessment.complexity}`);
    console.log(`  - risk:       ${workItem.assessment.risk}`);
    console.log(`  - reason:     ${workItem.assessment.reason}`);
  }

  console.log("");
}

/**
 * Prints a summary list of WorkItems.
 */
export function printWorkItemList(workItems: WorkItem[]): void {
  console.log("");
  console.log("Work Items");
  if (workItems.length === 0) {
    console.log("- none");
    return;
  }

  for (const item of workItems) {
    console.log(
      `- ${item.id}: status=${item.status}, risk=${item.risk}, title=${item.title}`
    );
  }
  console.log("");
}
