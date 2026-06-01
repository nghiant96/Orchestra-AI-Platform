import fs from "node:fs/promises";
import path from "node:path";
const DEFAULT_FAST_KEYWORDS = [
    "readme",
    "docs",
    "documentation",
    "comment",
    "comments",
    "typo",
    "wording",
    "copy",
    "text",
    "logging"
];
const DEFAULT_SAFE_KEYWORDS = [
    "auth",
    "permission",
    "security",
    "secret",
    "token",
    "credential",
    "payment",
    "billing",
    "checkout",
    "database",
    "db",
    "schema",
    "migration",
    "sql",
    "production",
    "deploy",
    "delete",
    "drop"
];
const RISKY_PATH_PATTERNS = [
    /(^|\/)auth(\/|$)/,
    /(^|\/)security(\/|$)/,
    /(^|\/)payment(\/|$)/,
    /(^|\/)billing(\/|$)/,
    /(^|\/)db(\/|$)/,
    /(^|\/)database(\/|$)/,
    /(^|\/)migrations?(\/|$)/,
    /(^|\/)prisma(\/|$)/,
    /schema\.prisma$/,
    /\.sql$/,
    /docker/i,
    /(^|\/)infra(\/|$)/,
    /(^|\/)deploy(\/|$)/,
    /(^|\/)\.github\//,
    /(^|\/)workflows\//
];
const DOC_PATH_PATTERNS = [/\.mdx?$/i, /(^|\/)docs(\/|$)/i, /(^|\/)README/i, /(^|\/)CHANGELOG/i];
const REPO_SIGNAL_FILES = [
    {
        file: "prisma/schema.prisma",
        signal: {
            name: "repo:prisma",
            matched: true,
            details: "Repository contains Prisma schema.",
            scores: { safe: 2 }
        }
    },
    {
        file: "docker-compose.yml",
        signal: {
            name: "repo:docker-compose",
            matched: true,
            details: "Repository contains docker-compose.yml.",
            scores: { safe: 1, balanced: 1 }
        }
    },
    {
        file: "Dockerfile",
        signal: {
            name: "repo:dockerfile",
            matched: true,
            details: "Repository contains Dockerfile.",
            scores: { safe: 1 }
        }
    },
    {
        file: "pnpm-lock.yaml",
        signal: {
            name: "repo:pnpm-workspace",
            matched: true,
            details: "Repository uses pnpm.",
            scores: { balanced: 1 }
        }
    },
    {
        file: "tsconfig.json",
        signal: {
            name: "repo:typescript",
            matched: true,
            details: "Repository contains tsconfig.json.",
            scores: { balanced: 1 }
        }
    }
];
export async function buildTaskSignals(task, routing) {
    const normalizedTask = String(task || "").trim().toLowerCase();
    if (!normalizedTask) {
        return [];
    }
    const fastKeywords = collectRoutingKeywords(routing, "fast", DEFAULT_FAST_KEYWORDS);
    const safeKeywords = collectRoutingKeywords(routing, "safe", DEFAULT_SAFE_KEYWORDS);
    const matchedFast = fastKeywords.filter((keyword) => normalizedTask.includes(keyword));
    const matchedSafe = safeKeywords.filter((keyword) => normalizedTask.includes(keyword));
    const signals = [];
    if (matchedFast.length > 0) {
        signals.push({
            name: "task:fast-keywords",
            matched: true,
            details: `Task matches low-risk keywords: ${matchedFast.join(", ")}.`,
            scores: { fast: 3 }
        });
    }
    if (matchedSafe.length > 0) {
        signals.push({
            name: "task:safe-keywords",
            matched: true,
            details: `Task matches high-risk keywords: ${matchedSafe.join(", ")}.`,
            scores: { safe: 4 }
        });
    }
    return signals;
}
export async function buildRepoSignals(repoRoot) {
    const signals = [];
    for (const entry of REPO_SIGNAL_FILES) {
        try {
            await fs.access(path.join(repoRoot, entry.file));
            signals.push(entry.signal);
        }
        catch {
            continue;
        }
    }
    return signals;
}
export function buildPlanSignals(plan) {
    if (!plan) {
        return [];
    }
    const paths = [...(plan.readFiles ?? []), ...(plan.writeTargets ?? [])].map((value) => String(value || ""));
    const writeTargets = plan.writeTargets ?? [];
    const signals = [];
    if (writeTargets.length > 3) {
        signals.push({
            name: "plan:many-writes",
            matched: true,
            details: `Plan writes ${writeTargets.length} files.`,
            scores: { safe: 2, balanced: 1 }
        });
    }
    const riskyPaths = writeTargets.filter((filePath) => isRiskyPath(filePath));
    if (riskyPaths.length > 0) {
        signals.push({
            name: "plan:risky-paths",
            matched: true,
            details: `Plan targets risky paths: ${riskyPaths.join(", ")}.`,
            scores: { safe: 4 }
        });
    }
    const docsOnly = paths.length > 0 && paths.every((filePath) => isDocumentationPath(filePath));
    if (docsOnly) {
        signals.push({
            name: "plan:docs-only",
            matched: true,
            details: "Plan only touches documentation-style files.",
            scores: { fast: 3 }
        });
    }
    const configPaths = writeTargets.filter((filePath) => looksLikeConfigPath(filePath));
    if (configPaths.length > 0) {
        signals.push({
            name: "plan:config-paths",
            matched: true,
            details: `Plan updates config or infrastructure files: ${configPaths.join(", ")}.`,
            scores: { safe: 2 }
        });
    }
    return signals;
}
export function classifyRoutingCategory(task, plan) {
    const normalizedTask = String(task || "").trim().toLowerCase();
    const paths = [...(plan?.readFiles ?? []), ...(plan?.writeTargets ?? [])].map((value) => String(value || ""));
    const docsTask = DEFAULT_FAST_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));
    const riskyTask = DEFAULT_SAFE_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));
    const docsPaths = paths.length > 0 && paths.every((filePath) => isDocumentationPath(filePath));
    const riskyPaths = paths.some((filePath) => isRiskyPath(filePath) || looksLikeConfigPath(filePath));
    if (riskyTask || riskyPaths) {
        return "risky";
    }
    if (docsTask || docsPaths) {
        return "docs";
    }
    return "general";
}
function collectRoutingKeywords(routing, profileName, fallback) {
    const configured = routing.heuristics?.[profileName];
    if (!Array.isArray(configured)) {
        return fallback;
    }
    const normalized = configured.map((keyword) => String(keyword).trim().toLowerCase()).filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
}
function isRiskyPath(filePath) {
    const normalized = normalizePath(filePath);
    return RISKY_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}
function isDocumentationPath(filePath) {
    const normalized = normalizePath(filePath);
    return DOC_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}
function looksLikeConfigPath(filePath) {
    const normalized = normalizePath(filePath);
    return /(^|\/)(package\.json|tsconfig\.json|docker-compose\.yml|Dockerfile|\.github\/workflows\/)/i.test(normalized);
}
function normalizePath(filePath) {
    return String(filePath || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
