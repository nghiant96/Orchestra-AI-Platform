import crypto from "node:crypto";
import { runCommand } from "../utils/api.js";
import { parseJsonResponse } from "../utils/string.js";
import type {
  JsonObject,
  MemoryAdapter,
  MemoryConfig,
  MemoryMatch,
  MemorySearchInput,
  MemoryStoreInput,
  Logger
} from "../types.js";

interface OpenMemoryRequestOptions {
  method?: string;
  body?: string;
  timeoutMs?: number;
}

type OpenMemoryItem = JsonObject & {
  id?: string | number;
  memory_id?: string | number;
  kind?: string;
  type?: string;
  createdAt?: string;
  created_at?: string;
  last_seen_at?: string;
  score?: number | string;
  relevance?: number | string;
  summary?: string;
  content?: string;
  text?: string;
  memory?: string;
  files?: string[];
  task?: string;
  outcome?: string;
  metadata?: JsonObject & {
    task?: string;
    outcome?: string;
    files?: string[];
    changedFiles?: string[];
    writeTargets?: string[];
  };
};

export class OpenMemoryAdapter implements MemoryAdapter {
  repoRoot: string;
  config: MemoryConfig;
  logger?: Logger;
  transport: string;
  id: string;
  command: string;
  baseUrl: string;
  maxResults: number;
  userId: string;
  healthChecked: boolean;

  constructor({ repoRoot, config, logger }: { repoRoot: string; config: MemoryConfig; logger?: Logger }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.logger = logger;
    this.transport = config.transport || (config.base_url ? "http" : "cli");
    this.id = `openmemory-${this.transport}`;
    this.command = config.command || "opm";
    this.baseUrl = stripTrailingSlash(config.base_url || "http://127.0.0.1:8080");
    this.maxResults = config.max_results ?? 4;
    this.userId = config.user_id || buildRepoScopedUserId(repoRoot);
    this.healthChecked = false;
  }

  async searchRelevant({ task, stage, plan }: MemorySearchInput): Promise<MemoryMatch[]> {
    await this.ensureHealthy();

    const query = buildQuery(task, stage, plan);

    if (this.transport === "http") {
      const payload = await this.requestJson("/memory/query", {
        method: "POST",
        body: JSON.stringify({
          query,
          k: this.maxResults,
          user_id: this.userId,
          filters: { user_id: this.userId }
        })
      });
      const matches = normalizeQueryResults(payload);
      if (matches.length > 0) {
        return matches;
      }

      const fallback = await this.requestJson(
        `/memory/all?user_id=${encodeURIComponent(this.userId)}&l=${encodeURIComponent(String(this.config.fallback_scan_limit ?? 50))}`,
        {
          method: "GET",
          timeoutMs: this.config.query_timeout_ms ?? 15000
        }
      );
      const fallbackItems = (fallback && typeof fallback === "object" ? (fallback as JsonObject).items : []) ?? [];
      return scoreFallbackItems(fallbackItems, query, stage, this.maxResults);
    }

    const args = [
      "query",
      query,
      "--user",
      this.userId,
      "--limit",
      String(this.maxResults)
    ];

    const { stdout } = await runCommand({
      command: this.command,
      args,
      cwd: this.repoRoot,
      timeoutMs: this.config.query_timeout_ms ?? 15000
    });

    return normalizeQueryResults(stdout);
  }

  formatForPrompt(memories: MemoryMatch[], stage: string): string {
    if (!Array.isArray(memories) || memories.length === 0) {
      return "";
    }

    const lines = [
      `Relevant project memories from OpenMemory for ${stage}:`,
      "Use these only when directly relevant to the current task."
    ];

    for (const memory of memories) {
      const changedFiles = memory.files.length > 0 ? ` Changed files: ${memory.files.join(", ")}.` : "";
      lines.push(`- ${memory.summary}${changedFiles}`);
    }

    const joined = lines.join("\n");
    const maxChars = this.config.max_prompt_chars ?? 1600;
    return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars - 3)}...`;
  }

  async storeRunSummary({ task, plan, result, iterations, issueCounts, providers, success, dryRun }: MemoryStoreInput) {
    await this.ensureHealthy();

    const text = buildOpenMemoryText({
      task,
      plan,
      result,
      iterations,
      issueCounts,
      providers,
      success,
      dryRun
    });

    if (this.transport === "http") {
      await this.requestJson("/memory/add", {
        method: "POST",
        body: JSON.stringify({
          content: text,
          tags: ["ai-system", "run-summary", dryRun ? "dry-run" : success ? "success" : "failure"],
          metadata: {
            source: "ai-system",
            task,
            readFiles: plan?.readFiles ?? [],
            writeTargets: plan?.writeTargets ?? [],
            changedFiles: result?.files?.map((file) => file.path) ?? [],
            providers,
            issueCounts,
            outcome: dryRun ? "dry-run" : success ? "success" : "failure"
          },
          user_id: this.userId
        })
      });
      return true;
    }

    const args = [
      "add",
      text,
      "--user",
      this.userId,
      "--tags",
      ["ai-system", "run-summary", dryRun ? "dry-run" : success ? "success" : "failure"].join(",")
    ];

    await runCommand({
      command: this.command,
      args,
      cwd: this.repoRoot,
      timeoutMs: this.config.store_timeout_ms ?? 15000
    });

    return true;
  }

  async ensureHealthy(): Promise<void> {
    if (this.healthChecked) {
      return;
    }

    if (this.transport === "http") {
      await this.requestJson("/health", {
        method: "GET",
        timeoutMs: this.config.health_timeout_ms ?? 10000
      });
    } else {
      await runCommand({
        command: this.command,
        args: ["health"],
        cwd: this.repoRoot,
        timeoutMs: this.config.health_timeout_ms ?? 10000
      });
    }

    this.healthChecked = true;
  }

  async requestJson(route: string, { method = "GET", body, timeoutMs }: OpenMemoryRequestOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    if (this.config.api_key) {
      headers["x-api-key"] = this.config.api_key;
    }

    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs ?? this.defaultTimeoutForRoute(route))
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OpenMemory HTTP ${response.status} for ${route}: ${raw.slice(0, 300) || response.statusText}`);
    }

    return raw ? JSON.parse(raw) : {};
  }

  defaultTimeoutForRoute(route: string): number {
    if (route === "/health") {
      return this.config.health_timeout_ms ?? 10000;
    }
    if (route === "/memory/query") {
      return this.config.query_timeout_ms ?? 15000;
    }
    if (route === "/memory/add") {
      return this.config.store_timeout_ms ?? 15000;
    }
    return this.config.request_timeout_ms ?? 15000;
  }
}

function buildRepoScopedUserId(repoRoot: string): string {
  const hash = crypto.createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
  return `repo_${hash}`;
}

function buildQuery(task: string, stage: string, plan?: { readFiles?: string[]; writeTargets?: string[] } | null): string {
  return [task, stage, ...(plan?.readFiles ?? []), ...(plan?.writeTargets ?? [])].filter(Boolean).join(" ");
}

function normalizeQueryResults(input: unknown): MemoryMatch[] {
  if (typeof input === "string") {
    const json = tryParseQueryJson(input);
    if (json) {
      return normalizeJsonResults(json);
    }

    return input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((line, index) => ({
        id: `line-${index + 1}`,
        kind: "openmemory",
        createdAt: "",
        score: Math.max(10 - index, 1),
        summary: line,
        files: [],
        task: "",
        outcome: "memory"
      }));
  }

  return normalizeJsonResults(input);
}

function tryParseQueryJson(stdout: string): unknown | null {
  try {
    return parseJsonResponse(stdout, "OpenMemory query output");
  } catch {
    return null;
  }
}

function normalizeJsonResults(payload: unknown): MemoryMatch[] {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as JsonObject | null | undefined)?.matches)
      ? ((payload as JsonObject).matches as unknown[])
      : Array.isArray((payload as JsonObject | null | undefined)?.results)
        ? ((payload as JsonObject).results as unknown[])
        : Array.isArray((payload as JsonObject | null | undefined)?.memories)
          ? ((payload as JsonObject).memories as unknown[])
          : [];

  return items.map((rawItem, index) => {
    const item = (rawItem && typeof rawItem === "object" ? rawItem : {}) as OpenMemoryItem;
    const summary = item?.summary || item?.content || item?.text || item?.memory || JSON.stringify(item);
    const metadata: OpenMemoryItem["metadata"] =
      item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const files = Array.isArray(item?.files)
      ? item.files
      : Array.isArray(metadata?.changedFiles)
        ? metadata.changedFiles
        : Array.isArray(metadata?.files)
          ? metadata.files
          : [];

    return {
      id: String(item?.id ?? item?.memory_id ?? `json-${index + 1}`),
      kind: item?.kind || item?.type || "openmemory",
      createdAt: item?.createdAt || item?.created_at || item?.last_seen_at || "",
      score: Number(item?.score ?? item?.relevance ?? items.length - index) || 0,
      summary,
      files,
      task: item?.task || metadata?.task || "",
      outcome: item?.outcome || metadata?.outcome || "memory"
    };
  });
}

function scoreFallbackItems(items: unknown, query: string, stage: string, limit: number): MemoryMatch[] {
  const queryTokens = tokenize(query);
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      item,
      index,
      score: scoreItem(item, queryTokens, stage)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item, score }, index) => {
      const normalizedItem = (item && typeof item === "object" ? item : {}) as OpenMemoryItem;
      return {
        id: String(normalizedItem.id ?? `fallback-${index + 1}`),
        kind: "openmemory",
        createdAt: normalizedItem.created_at || "",
        score,
        summary: normalizedItem.content || JSON.stringify(normalizedItem),
        files: Array.isArray(normalizedItem.metadata?.changedFiles) ? normalizedItem.metadata.changedFiles : [],
        task: normalizedItem.metadata?.task || "",
        outcome: normalizedItem.metadata?.outcome || "memory"
      };
    });
}

function scoreItem(item: unknown, queryTokens: Set<string>, stage: string): number {
  const normalizedItem = (item && typeof item === "object" ? item : {}) as OpenMemoryItem;
  const haystack = [
    normalizedItem.content,
    normalizedItem.metadata?.task,
    ...(Array.isArray(normalizedItem.metadata?.changedFiles) ? normalizedItem.metadata.changedFiles : []),
    ...(Array.isArray(normalizedItem.metadata?.writeTargets) ? normalizedItem.metadata.writeTargets : [])
  ]
    .filter(Boolean)
    .join(" ");

  const itemTokens = tokenize(haystack);
  let overlap = 0;
  for (const token of queryTokens) {
    if (itemTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap + (stage ? 0.1 : 0);
}

function tokenize(text: string): Set<string> {
  return new Set<string>(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function buildOpenMemoryText({ task, plan, result, iterations, issueCounts, providers, success, dryRun }: MemoryStoreInput): string {
  return [
    `Task: ${task}`,
    `Outcome: ${dryRun ? "dry-run" : success ? "success" : "failure"}`,
    `Summary: ${summarizeRun(result, iterations)}`,
    `Read files: ${(plan?.readFiles ?? []).join(", ") || "(none)"}`,
    `Write targets: ${(plan?.writeTargets ?? []).join(", ") || "(none)"}`,
    `Changed files: ${(result?.files?.map((file) => file.path) ?? []).join(", ") || "(none)"}`,
    `Issue counts: high=${issueCounts?.high ?? 0}, medium=${issueCounts?.medium ?? 0}, low=${issueCounts?.low ?? 0}`,
    `Providers: planner=${providers?.planner}, reviewer=${providers?.reviewer}, generator=${providers?.generator}, fixer=${providers?.fixer}`
  ].join("\n");
}

function summarizeRun(result: MemoryStoreInput["result"], iterations: MemoryStoreInput["iterations"]): string {
  const changedFiles = result?.files?.map((file) => file.path) ?? [];
  const latestSummary = iterations?.at(-1)?.summary ?? "No review summary available.";
  return changedFiles.length > 0
    ? `${latestSummary} Changed files: ${changedFiles.join(", ")}.`
    : latestSummary;
}

function stripTrailingSlash(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}
