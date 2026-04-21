import crypto from "node:crypto";
import { runCommand } from "../utils/api.js";
import { parseJsonResponse } from "../utils/string.js";

export class OpenMemoryAdapter {
  constructor({ repoRoot, config, logger }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.logger = logger;
    this.id = "openmemory";
    this.command = config.command || "opm";
    this.maxResults = config.max_results ?? 4;
    this.userId = config.user_id || buildRepoScopedUserId(repoRoot);
    this.healthChecked = false;
  }

  async searchRelevant({ task, stage, plan }) {
    await this.ensureHealthy();

    const query = buildQuery(task, stage, plan);
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

  formatForPrompt(memories, stage) {
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

  async storeRunSummary({ task, plan, result, iterations, issueCounts, providers, success, dryRun }) {
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

    const tags = [
      "ai-system",
      "run-summary",
      dryRun ? "dry-run" : success ? "success" : "failure"
    ].join(",");

    const args = [
      "add",
      text,
      "--user",
      this.userId,
      "--tags",
      tags
    ];

    await runCommand({
      command: this.command,
      args,
      cwd: this.repoRoot,
      timeoutMs: this.config.store_timeout_ms ?? 15000
    });

    return true;
  }

  async ensureHealthy() {
    if (this.healthChecked) {
      return;
    }

    await runCommand({
      command: this.command,
      args: ["health"],
      cwd: this.repoRoot,
      timeoutMs: this.config.health_timeout_ms ?? 10000
    });

    this.healthChecked = true;
  }
}

function buildRepoScopedUserId(repoRoot) {
  const hash = crypto.createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
  return `repo_${hash}`;
}

function buildQuery(task, stage, plan) {
  return [
    task,
    stage,
    ...(plan?.readFiles ?? []),
    ...(plan?.writeTargets ?? [])
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeQueryResults(stdout) {
  const json = tryParseQueryJson(stdout);
  if (json) {
    return normalizeJsonResults(json);
  }

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);

  return lines.map((line, index) => ({
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

function tryParseQueryJson(stdout) {
  try {
    return parseJsonResponse(stdout, "OpenMemory query output");
  } catch {
    return null;
  }
}

function normalizeJsonResults(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.memories)
        ? payload.memories
        : [];

  return items.map((item, index) => {
    const summary =
      item?.summary ||
      item?.content ||
      item?.text ||
      item?.memory ||
      JSON.stringify(item);

    return {
      id: String(item?.id ?? item?.memory_id ?? `json-${index + 1}`),
      kind: item?.kind || item?.type || "openmemory",
      createdAt: item?.createdAt || item?.created_at || "",
      score: Number(item?.score ?? item?.relevance ?? items.length - index) || 0,
      summary,
      files: Array.isArray(item?.files) ? item.files : [],
      task: item?.task || "",
      outcome: item?.outcome || "memory"
    };
  });
}

function buildOpenMemoryText({ task, plan, result, iterations, issueCounts, providers, success, dryRun }) {
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

function summarizeRun(result, iterations) {
  const changedFiles = result?.files?.map((file) => file.path) ?? [];
  const latestSummary = iterations?.at(-1)?.summary ?? "No review summary available.";
  return changedFiles.length > 0
    ? `${latestSummary} Changed files: ${changedFiles.join(", ")}.`
    : latestSummary;
}
