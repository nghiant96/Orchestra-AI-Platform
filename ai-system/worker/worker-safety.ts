import path from "node:path";
import { redactSecrets } from "../security/secret-redaction.js";

export function redactWorkerLogLine(value: string): string {
  return redactSecrets(value);
}

export function parseCsvList(value: string | undefined | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeWorkspaceRoots(values: string[], fallbackRoot: string): string[] {
  const roots = values.length > 0 ? values : [fallbackRoot];
  return [...new Set(roots.map((entry) => path.resolve(entry)))];
}

export function ensurePathWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${candidate}`);
  }
  return resolvedCandidate;
}
