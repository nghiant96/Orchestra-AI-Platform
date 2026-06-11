import fs from "node:fs/promises";
import path from "node:path";

export interface IntegrationEndpointRef {
  file: string;
  line: number;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";
  endpoint: string;
}

export interface IntegrationMismatch {
  endpoint: string;
  kind: "frontend-without-backend" | "backend-without-frontend";
  files: string[];
}

export interface IntegrationCheckReport {
  version: 1;
  generatedAt: string;
  repoRoot: string;
  frontend: {
    endpointCount: number;
    endpoints: IntegrationEndpointRef[];
  };
  backend: {
    routeCount: number;
    routes: IntegrationEndpointRef[];
  };
  mismatches: IntegrationMismatch[];
  warnings: string[];
}

const FRONTEND_ROOTS = ["dashboard/src"];
const BACKEND_ROOTS = ["ai-system/server", "ai-system/workers"];

export async function analyzeIntegration(repoRoot: string): Promise<IntegrationCheckReport> {
  const [frontendFiles, backendFiles] = await Promise.all([
    collectSourceFiles(repoRoot, FRONTEND_ROOTS),
    collectSourceFiles(repoRoot, BACKEND_ROOTS)
  ]);

  const frontendEndpoints = (await Promise.all(frontendFiles.map(async (file) => extractFrontendEndpoints(file)))).flat();
  const backendRoutes = (await Promise.all(backendFiles.map(async (file) => extractBackendRoutes(file)))).flat();

  const backendPatternIndex = indexByEndpoint(backendRoutes);
  const frontendPatternIndex = indexByEndpoint(frontendEndpoints);
  const mismatches: IntegrationMismatch[] = [];

  for (const [endpoint, refs] of frontendPatternIndex.entries()) {
    if (!backendPatternIndex.has(endpoint)) {
      mismatches.push({
        endpoint,
        kind: "frontend-without-backend",
        files: refs.map((ref) => ref.file)
      });
    }
  }

  for (const [endpoint, refs] of backendPatternIndex.entries()) {
    if (!frontendPatternIndex.has(endpoint)) {
      mismatches.push({
        endpoint,
        kind: "backend-without-frontend",
        files: refs.map((ref) => ref.file)
      });
    }
  }

  const warnings = mismatches.map((mismatch) =>
    mismatch.kind === "frontend-without-backend"
      ? `Frontend calls ${mismatch.endpoint} but no backend route was detected.`
      : `Backend route ${mismatch.endpoint} is not referenced by frontend API calls.`
  );

  const report: IntegrationCheckReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    repoRoot,
    frontend: {
      endpointCount: frontendEndpoints.length,
      endpoints: frontendEndpoints
    },
    backend: {
      routeCount: backendRoutes.length,
      routes: backendRoutes
    },
    mismatches,
    warnings
  };

  await writeIntegrationReport(repoRoot, report);
  return report;
}

export async function writeIntegrationReport(repoRoot: string, report: IntegrationCheckReport): Promise<string> {
  const target = path.join(repoRoot, "integration", "integration-check.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

async function collectSourceFiles(repoRoot: string, roots: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    files.push(...await walk(path.join(repoRoot, root)));
  }
  return files.filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
}

async function walk(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const output: string[] = [];
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        output.push(...await walk(fullPath));
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }
    return output;
  } catch {
    return [];
  }
}

async function extractFrontendEndpoints(filePath: string): Promise<IntegrationEndpointRef[]> {
  const content = await fs.readFile(filePath, "utf8");
  const refs: IntegrationEndpointRef[] = [];
  const patterns: Array<{ regex: RegExp; method: IntegrationEndpointRef["method"] }> = [
    { regex: /(?:apiJson|apiFetch|fetch)\(\s*([`'"])([\s\S]*?)\1/g, method: "ANY" },
    { regex: /\baxios\.(get|post|put|patch|delete)\(\s*([`'"])([\s\S]*?)\2/g, method: "ANY" },
    { regex: /\bapiClient\.(get|post|put|patch|delete)\(\s*([`'"])([\s\S]*?)\2/g, method: "ANY" }
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const method = match[1] ? normalizeMethod(String(match[1])) : inferMethod(content, match.index ?? 0);
      const raw = match[3] ?? match[2] ?? "";
      refs.push({
        file: relativeDisplayPath(filePath),
        line: lineNumberAt(content, match.index ?? 0),
        method: method === "ANY" ? pattern.method : method,
        endpoint: normalizeEndpoint(raw)
      });
    }
  }
  return refs;
}

async function extractBackendRoutes(filePath: string): Promise<IntegrationEndpointRef[]> {
  const content = await fs.readFile(filePath, "utf8");
  const refs: IntegrationEndpointRef[] = [];

  for (const match of content.matchAll(/url\.pathname\s*===\s*([`'"])([\s\S]*?)\1/g)) {
    const raw = match[2] ?? "";
    refs.push({
      file: relativeDisplayPath(filePath),
      line: lineNumberAt(content, match.index ?? 0),
      method: inferMethodFromRouteBlock(content, match.index ?? 0),
      endpoint: normalizeEndpoint(raw)
    });
  }

  for (const match of content.matchAll(/const\s+\w+\s*=\s*\/\^\\\/([\s\S]*?)\\\$\/\.exec\(url\.pathname\)/g)) {
    const rawPattern = match[1] ?? "";
    refs.push({
      file: relativeDisplayPath(filePath),
      line: lineNumberAt(content, match.index ?? 0),
      method: inferMethodFromRouteBlock(content, match.index ?? 0),
      endpoint: normalizeRegexRoute(rawPattern)
    });
  }

  for (const match of content.matchAll(/router\.(get|post|put|patch|delete)\(\s*([`'"])([\s\S]*?)\2/g)) {
    refs.push({
      file: relativeDisplayPath(filePath),
      line: lineNumberAt(content, match.index ?? 0),
      method: normalizeMethod(match[1] ?? "ANY"),
      endpoint: normalizeEndpoint(match[3] ?? "")
    });
  }

  for (const match of content.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*([`'"])?([\s\S]*?)\2?\)/g)) {
    refs.push({
      file: relativeDisplayPath(filePath),
      line: lineNumberAt(content, match.index ?? 0),
      method: normalizeMethod(match[1] ?? "ANY"),
      endpoint: normalizeEndpoint(match[3] ?? "")
    });
  }

  return refs;
}

function indexByEndpoint(items: IntegrationEndpointRef[]): Map<string, IntegrationEndpointRef[]> {
  const map = new Map<string, IntegrationEndpointRef[]>();
  for (const item of items) {
    const key = normalizeEndpoint(item.endpoint);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/\?.*$/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
}

function normalizeRegexRoute(pattern: string): string {
  return normalizeEndpoint(
    `/${pattern}`
      .replace(/\\\//g, "/")
      .replace(/\(\[\^\/\]\+\)/g, ":param")
      .replace(/\(\?:[^)]+\)/g, ":param")
      .replace(/\(\.\*\?\)/g, ":param")
  );
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function inferMethod(content: string, index: number): IntegrationEndpointRef["method"] {
  const preceding = content.slice(Math.max(0, index - 180), index);
  if (/method:\s*["']POST["']/i.test(preceding) || /method\s*:\s*["']POST["']/i.test(preceding)) return "POST";
  if (/method:\s*["']PUT["']/i.test(preceding)) return "PUT";
  if (/method:\s*["']PATCH["']/i.test(preceding)) return "PATCH";
  if (/method:\s*["']DELETE["']/i.test(preceding)) return "DELETE";
  if (/method:\s*["']GET["']/i.test(preceding)) return "GET";
  return "ANY";
}

function inferMethodFromRouteBlock(content: string, index: number): IntegrationEndpointRef["method"] {
  const preceding = content.slice(Math.max(0, index - 260), index);
  if (/req\.method\s*===\s*["']POST["']/i.test(preceding)) return "POST";
  if (/req\.method\s*===\s*["']PUT["']/i.test(preceding)) return "PUT";
  if (/req\.method\s*===\s*["']PATCH["']/i.test(preceding)) return "PATCH";
  if (/req\.method\s*===\s*["']DELETE["']/i.test(preceding)) return "DELETE";
  if (/req\.method\s*===\s*["']GET["']/i.test(preceding)) return "GET";
  return "ANY";
}

function normalizeMethod(value: string): IntegrationEndpointRef["method"] {
  const upper = value.toUpperCase();
  return upper === "GET" || upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE"
    ? upper
    : "ANY";
}

function relativeDisplayPath(filePath: string): string {
  const cwd = process.cwd();
  return path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
}
