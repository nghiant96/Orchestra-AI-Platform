import fs from "node:fs/promises";
import path from "node:path";
import type { Worker } from "./worker-types.js";

const WORKER_ID_PATTERN = /^worker-[a-z0-9][a-z0-9-]{0,160}$/i;

export class WorkerStore {
  constructor(private readonly storeDir: string) {}

  static generateId(name: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `worker-${timestamp}-${random}`;
  }

  static generateSessionToken(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 18);
    return `ws_${ts}_${rand}`;
  }

  async create(worker: Partial<Worker> & Pick<Worker, "name">): Promise<Worker> {
    const id = worker.id || WorkerStore.generateId(worker.name);
    const sessionToken = worker.sessionToken || WorkerStore.generateSessionToken();
    const now = new Date().toISOString();
    const record: Worker = {
      id,
      name: worker.name,
      version: worker.version || "0.1.0",
      os: worker.os || process.platform,
      arch: worker.arch || process.arch,
      labels: worker.labels || [],
      capabilities: worker.capabilities || {},
      workspaceRoots: worker.workspaceRoots || [],
      status: worker.status || "online",
      lastHeartbeatAt: worker.lastHeartbeatAt || now,
      sessionToken,
      createdAt: worker.createdAt || now,
      currentJobId: worker.currentJobId,
      freeDiskGb: worker.freeDiskGb,
      cpuLoad: worker.cpuLoad
    };
    await this.save(record);
    return record;
  }

  async save(worker: Worker): Promise<void> {
    this.validateId(worker.id);
    await fs.mkdir(this.storeDir, { recursive: true });
    const filePath = this.workerPath(worker.id);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(worker, null, 2), "utf8");
    await fs.rename(tmpPath, filePath);
  }

  async load(id: string): Promise<Worker | null> {
    if (!WORKER_ID_PATTERN.test(id)) return null;
    try {
      const raw = await fs.readFile(this.workerPath(id), "utf8");
      return JSON.parse(raw) as Worker;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async list(): Promise<Worker[]> {
    try {
      const entries = await fs.readdir(this.storeDir, { withFileTypes: true });
      const workers: Worker[] = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          const id = entry.name.replace(/\.json$/, "");
          const worker = await this.load(id);
          if (worker) workers.push(worker);
        }
      }
      return workers.sort((a, b) => b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt));
    } catch (err: any) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!WORKER_ID_PATTERN.test(id)) return false;
    try {
      await fs.unlink(this.workerPath(id));
      return true;
    } catch {
      return false;
    }
  }

  private validateId(id: string): void {
    if (!WORKER_ID_PATTERN.test(id)) {
      throw new Error(`Invalid worker id: ${id}`);
    }
    const resolvedStore = path.resolve(this.storeDir);
    const resolvedPath = path.resolve(this.workerPath(id));
    const relative = path.relative(resolvedStore, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Invalid worker id: ${id}`);
    }
  }

  private workerPath(id: string): string {
    return path.join(this.storeDir, `${id}.json`);
  }
}

export function resolveWorkerStoreDir(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "workers");
}
