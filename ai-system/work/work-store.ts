import fs from "node:fs/promises";
import path from "node:path";
import { normalizeWorkItem } from "./normalizers.js";
import type { ChecklistItem, ExecutionGraph, TaskAssessment, WorkItem } from "./work-item.js";
import type { RulesConfig } from "../types.js";

const WORK_ITEM_ID_PATTERN = /^work-[A-Za-z0-9][A-Za-z0-9-]{0,160}$/;
const EMPTY_GRAPH: ExecutionGraph = { nodes: [], edges: [] };

interface AssessmentRecord {
  schemaVersion: number;
  workItemId: string;
  assessment: TaskAssessment | null;
}

interface TaskGraphRecord {
  schemaVersion: number;
  workItemId: string;
  graph: ExecutionGraph;
}

interface ChecklistRecord {
  schemaVersion: number;
  workItemId: string;
  items: ChecklistItem[];
}

interface RunsRecord {
  schemaVersion: number;
  workItemId: string;
  linkedRuns: string[];
}

/**
 * Handles persistence for WorkItems under .ai-system-artifacts/work-items/
 */
export class WorkStore {
  private baseDir: string;

  constructor(repoRoot: string, rules: RulesConfig) {
    const dataDir = rules.artifacts?.data_dir || ".ai-system-artifacts";
    this.baseDir = path.join(repoRoot, dataDir, "work-items");
  }

  /**
   * Generates a unique, filesystem-safe ID for a WorkItem.
   */
  static generateId(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
    const timestamp = new Date()
      .toISOString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 19);
    const random = Math.random().toString(36).slice(2, 6);
    return `work-${timestamp}-${slug || "task"}-${random}`;
  }

  /**
   * Creates a new WorkItem and persists it.
   */
  async create(payload: Partial<WorkItem> & { title: string; projectId: string }): Promise<WorkItem> {
    const id = payload.id || WorkStore.generateId(payload.title);
    this.resolveWorkDir(id);
    const now = new Date().toISOString();

    const workItem: WorkItem = normalizeWorkItem({
      ...payload,
      id,
      status: payload.status || "created",
      createdAt: now,
      updatedAt: now
    });

    await this.save(workItem);
    return workItem;
  }

  /**
   * Persists a WorkItem to disk.
   */
  async save(workItem: WorkItem): Promise<void> {
    const normalized = normalizeWorkItem(workItem);
    const workDir = this.resolveWorkDir(normalized.id);
    await fs.mkdir(workDir, { recursive: true });

    const { assessment, graph, checklist, linkedRuns, ...workItemRecord } = normalized;

    await writeJsonFile(path.join(workDir, "work-item.json"), workItemRecord);
    await writeJsonFile(path.join(workDir, "assessment.json"), {
      schemaVersion: 1,
      workItemId: normalized.id,
      assessment: assessment ?? null
    } satisfies AssessmentRecord);
    await writeJsonFile(path.join(workDir, "task-graph.json"), {
      schemaVersion: 1,
      workItemId: normalized.id,
      graph: graph ?? EMPTY_GRAPH
    } satisfies TaskGraphRecord);
    await writeJsonFile(path.join(workDir, "checklist.json"), {
      schemaVersion: 1,
      workItemId: normalized.id,
      items: checklist ?? []
    } satisfies ChecklistRecord);
    await writeJsonFile(path.join(workDir, "runs.json"), {
      schemaVersion: 1,
      workItemId: normalized.id,
      linkedRuns: linkedRuns ?? []
    } satisfies RunsRecord);
  }

  /**
   * Loads a WorkItem by ID.
   */
  async load(id: string): Promise<WorkItem | null> {
    const workDir = this.resolveWorkDir(id);
    const filePath = path.join(workDir, "work-item.json");
    try {
      const rawWorkItem = await readJsonFile(filePath);
      const assessmentRecord = await readOptionalJsonFile<AssessmentRecord>(path.join(workDir, "assessment.json"));
      const graphRecord = await readOptionalJsonFile<TaskGraphRecord>(path.join(workDir, "task-graph.json"));
      const checklistRecord = await readOptionalJsonFile<ChecklistRecord | ChecklistItem[]>(path.join(workDir, "checklist.json"));
      const runsRecord = await readOptionalJsonFile<RunsRecord | string[]>(path.join(workDir, "runs.json"));

      return normalizeWorkItem({
        ...rawWorkItem,
        assessment: assessmentRecord?.assessment ?? rawWorkItem.assessment,
        graph: graphRecord?.graph ?? rawWorkItem.graph,
        checklist: Array.isArray(checklistRecord)
          ? checklistRecord
          : checklistRecord?.items ?? rawWorkItem.checklist,
        linkedRuns: Array.isArray(runsRecord)
          ? runsRecord
          : runsRecord?.linkedRuns ?? rawWorkItem.linkedRuns
      });
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  /**
   * Lists all WorkItems in the store.
   */
  async list(): Promise<WorkItem[]> {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      const workItems: WorkItem[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const item = await this.load(entry.name);
          if (item) workItems.push(item);
        }
      }

      return workItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (err: any) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  private resolveWorkDir(id: string): string {
    if (!WORK_ITEM_ID_PATTERN.test(id)) {
      throw new Error(`Invalid work item id: ${id}`);
    }
    const baseDir = path.resolve(this.baseDir);
    const workDir = path.resolve(baseDir, id);
    const relative = path.relative(baseDir, workDir);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Invalid work item id: ${id}`);
    }
    return workDir;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value, null, 2);
  const tempPath = `${filePath}.tmp-${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tempPath, data, "utf8");
  await fs.rename(tempPath, filePath);
}

async function readJsonFile(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return await readJsonFile(filePath);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
