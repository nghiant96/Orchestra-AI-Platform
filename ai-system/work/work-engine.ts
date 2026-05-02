import type { RulesConfig } from "../types.js";
import { assessWorkItem } from "./assessment.js";
import { buildChecklist } from "./checklist.js";
import { buildTaskGraph } from "./task-graph.js";
import type { WorkItem } from "./work-item.js";

export class WorkEngine {
  constructor(private readonly rules: RulesConfig) {}

  async assess(workItem: WorkItem): Promise<WorkItem> {
    const assessment = assessWorkItem(workItem, this.rules);
    const graph = buildTaskGraph(workItem);
    const checklist = buildChecklist(workItem, graph);
    return { ...workItem, status: "assessing", assessment, graph, checklist };
  }

  async createExecutionPlan(workItem: WorkItem): Promise<WorkItem> {
    const assessed = await this.assess(workItem);
    return {
      ...assessed,
      status: "planning",
      updatedAt: new Date().toISOString()
    };
  }
}
