import fs from "node:fs/promises";
import path from "node:path";
import { validatePath } from "../security/path-policy.js";

const REPO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/;

export interface RepoRegistryEntry {
  repoId: string;
  name: string;
  localPath: string;
  remote?: string;
  defaultBranch?: string;
  createdAt: string;
  updatedAt: string;
}

interface RepoRegistryFile {
  version: 1;
  repos: RepoRegistryEntry[];
  updatedAt: string;
}

export function resolveRepoRegistryPath(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "repos.json");
}

export class RepoRegistryStore {
  constructor(private readonly defaultCwd: string) {}

  async list(): Promise<RepoRegistryEntry[]> {
    const file = await this.load();
    return [...file.repos].sort((left, right) => left.repoId.localeCompare(right.repoId));
  }

  async get(repoId: string): Promise<RepoRegistryEntry | null> {
    if (!isSafeRepoId(repoId)) return null;
    const file = await this.load();
    return file.repos.find((repo) => repo.repoId === repoId) ?? null;
  }

  async register(
    input: { repoId?: unknown; name?: unknown; localPath?: unknown; remote?: unknown; defaultBranch?: unknown },
    allowedRoots: string[]
  ): Promise<RepoRegistryEntry> {
    const requestedPath = typeof input.localPath === "string" && input.localPath.trim()
      ? input.localPath.trim()
      : "";
    if (!requestedPath) {
      throw new RepoRegistryError("localPath is required", 400);
    }

    const validation = await validatePath(path.resolve(requestedPath), allowedRoots);
    if (!validation.allowed) {
      throw new RepoRegistryError("Repo path is outside AI_SYSTEM_ALLOWED_WORKDIRS", 403);
    }
    const localPath = validation.realpath ?? path.resolve(requestedPath);
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new RepoRegistryError("Repo path must point to an existing directory", 400);
    }

    const repoId = normalizeRepoId(input.repoId, localPath);
    const now = new Date().toISOString();
    const file = await this.load();
    const existing = file.repos.find((repo) => repo.repoId === repoId);
    const entry: RepoRegistryEntry = {
      repoId,
      name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : path.basename(localPath),
      localPath,
      remote: typeof input.remote === "string" && input.remote.trim() ? input.remote.trim() : existing?.remote,
      defaultBranch: typeof input.defaultBranch === "string" && input.defaultBranch.trim() ? input.defaultBranch.trim() : existing?.defaultBranch,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const repos = existing
      ? file.repos.map((repo) => repo.repoId === repoId ? entry : repo)
      : [...file.repos, entry];
    await this.save({ version: 1, repos, updatedAt: now });
    return entry;
  }

  private async load(): Promise<RepoRegistryFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(resolveRepoRegistryPath(this.defaultCwd), "utf8")) as Partial<RepoRegistryFile>;
      return {
        version: 1,
        repos: Array.isArray(parsed.repos) ? parsed.repos.filter(isRepoEntry) : [],
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { version: 1, repos: [], updatedAt: new Date().toISOString() };
      }
      throw err;
    }
  }

  private async save(file: RepoRegistryFile): Promise<void> {
    const targetPath = resolveRepoRegistryPath(this.defaultCwd);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }
}

export async function resolveRegisteredRepoPath(
  defaultCwd: string,
  repoId: unknown,
  allowedRoots: string[]
): Promise<RepoRegistryEntry | null> {
  if (typeof repoId !== "string" || !isSafeRepoId(repoId)) {
    return null;
  }
  const store = new RepoRegistryStore(defaultCwd);
  const repo = await store.get(repoId);
  if (!repo) return null;
  const validation = await validatePath(repo.localPath, allowedRoots);
  if (!validation.allowed) {
    throw new RepoRegistryError("Registered repo path is outside AI_SYSTEM_ALLOWED_WORKDIRS", 403);
  }
  return { ...repo, localPath: validation.realpath ?? repo.localPath };
}

export class RepoRegistryError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "RepoRegistryError";
  }
}

function normalizeRepoId(value: unknown, localPath: string): string {
  const explicit = typeof value === "string" ? value.trim() : "";
  const repoId = explicit || path.basename(localPath).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!isSafeRepoId(repoId)) {
    throw new RepoRegistryError("Invalid repoId", 400);
  }
  return repoId;
}

function isSafeRepoId(value: string): boolean {
  return REPO_ID_PATTERN.test(value);
}

function isRepoEntry(value: unknown): value is RepoRegistryEntry {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.repoId === "string" &&
    isSafeRepoId(raw.repoId) &&
    typeof raw.name === "string" &&
    typeof raw.localPath === "string" &&
    typeof raw.createdAt === "string" &&
    typeof raw.updatedAt === "string";
}
