import path from "node:path";
import { redactSecrets } from "../security/secret-redaction.js";
export function redactWorkerLogLine(value) {
    return redactSecrets(value);
}
export function parseCsvList(value) {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
export function normalizeWorkspaceRoots(values, fallbackRoot) {
    const roots = values.length > 0 ? values : [fallbackRoot];
    return [...new Set(roots.map((entry) => path.resolve(entry)))];
}
export function ensurePathWithinRoot(root, candidate) {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path escapes workspace root: ${candidate}`);
    }
    return resolvedCandidate;
}
