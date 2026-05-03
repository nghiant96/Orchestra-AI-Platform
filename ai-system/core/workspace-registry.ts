import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

interface WorkspaceRegistryFile {
  version: 1;
  roots: string[];
  updatedAt: string;
}

export function resolveWorkspaceRegistryPath(defaultCwd: string): string {
  return path.join(defaultCwd, ".ai-system-server", "workspaces.json");
}

export function loadAllowedWorkdirs(defaultCwd: string, envRoots: string[] = []): string[] {
  const registryRoots = loadWorkspaceRegistryRoots(defaultCwd);
  const merged = unique([
    ...normalizeRoots(envRoots),
    ...normalizeRoots(registryRoots)
  ]);
  return merged.length > 0 ? merged : [path.resolve(defaultCwd)];
}

export async function registerWorkspaceRoot(defaultCwd: string, cwd: string, existingRoots: string[]): Promise<string[]> {
  const resolved = normalizeWorkspaceRoot(cwd);
  if (!resolved) {
    throw new Error("Workspace path is required");
  }

  const stat = await fsPromises.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error("Workspace path must point to an existing directory");
  }

  const roots = unique([...normalizeRoots(existingRoots), resolved]);
  await persistWorkspaceRoots(defaultCwd, roots);
  return roots;
}

function loadWorkspaceRegistryRoots(defaultCwd: string): string[] {
  try {
    const file = fs.readFileSync(resolveWorkspaceRegistryPath(defaultCwd), "utf8");
    const parsed = JSON.parse(file) as Partial<WorkspaceRegistryFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.roots)) {
      return [];
    }
    return parsed.roots.filter((root): root is string => typeof root === "string");
  } catch {
    return [];
  }
}

async function persistWorkspaceRoots(defaultCwd: string, roots: string[]): Promise<void> {
  const filePath = resolveWorkspaceRegistryPath(defaultCwd);
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  const payload: WorkspaceRegistryFile = {
    version: 1,
    roots,
    updatedAt: new Date().toISOString()
  };
  await fsPromises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeRoots(values: string[]): string[] {
  return values.map(normalizeWorkspaceRoot).filter((root): root is string => Boolean(root));
}

function normalizeWorkspaceRoot(value: string): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const resolved = path.resolve(trimmed);
  return path.isAbsolute(resolved) ? resolved : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
