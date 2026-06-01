import fs from "node:fs/promises";
import path from "node:path";
import { normalizeWorkItem } from "./normalizers.js";
const WORK_ITEM_ID_PATTERN = /^work-[A-Za-z0-9][A-Za-z0-9-]{0,160}$/;
const EMPTY_GRAPH = { nodes: [], edges: [] };
/**
 * Handles persistence for WorkItems under .ai-system-artifacts/work-items/
 */
export class WorkStore {
    baseDir;
    constructor(repoRoot, rules) {
        const dataDir = rules.artifacts?.data_dir || ".ai-system-artifacts";
        this.baseDir = path.join(repoRoot, dataDir, "work-items");
    }
    /**
     * Generates a unique, filesystem-safe ID for a WorkItem.
     */
    static generateId(title) {
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
    async create(payload) {
        const id = payload.id || WorkStore.generateId(payload.title);
        this.resolveWorkDir(id);
        const now = new Date().toISOString();
        const workItem = normalizeWorkItem({
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
    async save(workItem) {
        const normalized = normalizeWorkItem(workItem);
        const workDir = this.resolveWorkDir(normalized.id);
        await fs.mkdir(workDir, { recursive: true });
        const { assessment, graph, checklist, linkedRuns, ...workItemRecord } = normalized;
        await writeJsonFile(path.join(workDir, "work-item.json"), workItemRecord);
        await writeJsonFile(path.join(workDir, "assessment.json"), {
            schemaVersion: 1,
            workItemId: normalized.id,
            assessment: assessment ?? null
        });
        await writeJsonFile(path.join(workDir, "task-graph.json"), {
            schemaVersion: 1,
            workItemId: normalized.id,
            graph: graph ?? EMPTY_GRAPH
        });
        await writeJsonFile(path.join(workDir, "checklist.json"), {
            schemaVersion: 1,
            workItemId: normalized.id,
            items: checklist ?? []
        });
        await writeJsonFile(path.join(workDir, "runs.json"), {
            schemaVersion: 1,
            workItemId: normalized.id,
            linkedRuns: linkedRuns ?? []
        });
    }
    /**
     * Loads a WorkItem by ID.
     */
    async load(id) {
        const workDir = this.resolveWorkDir(id);
        const filePath = path.join(workDir, "work-item.json");
        try {
            const rawWorkItem = await readJsonFile(filePath);
            const assessmentRecord = await readOptionalJsonFile(path.join(workDir, "assessment.json"));
            const graphRecord = await readOptionalJsonFile(path.join(workDir, "task-graph.json"));
            const checklistRecord = await readOptionalJsonFile(path.join(workDir, "checklist.json"));
            const runsRecord = await readOptionalJsonFile(path.join(workDir, "runs.json"));
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
        }
        catch (err) {
            if (err.code === "ENOENT")
                return null;
            throw err;
        }
    }
    /**
     * Lists all WorkItems in the store.
     */
    async list() {
        try {
            const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
            const workItems = [];
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const item = await this.load(entry.name);
                    if (item)
                        workItems.push(item);
                }
            }
            return workItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        }
        catch (err) {
            if (err.code === "ENOENT")
                return [];
            throw err;
        }
    }
    resolveWorkDir(id) {
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
async function writeJsonFile(filePath, value) {
    const data = JSON.stringify(value, null, 2);
    const tempPath = `${filePath}.tmp-${Math.random().toString(36).slice(2, 8)}`;
    await fs.writeFile(tempPath, data, "utf8");
    await fs.rename(tempPath, filePath);
}
async function readJsonFile(filePath) {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
}
async function readOptionalJsonFile(filePath) {
    try {
        return await readJsonFile(filePath);
    }
    catch (err) {
        if (err.code === "ENOENT")
            return null;
        throw err;
    }
}
