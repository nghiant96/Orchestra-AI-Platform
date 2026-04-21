import fs from "node:fs/promises";
import path from "node:path";
import { generateEmbedding, cosineSimilarity } from "../utils/embeddings.js";

export class LocalFileMemoryAdapter {
  constructor({ repoRoot, config, logger }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.logger = logger;
    this.id = "local-file";
    this.memoryDir = path.join(repoRoot, config.data_dir ?? ".ai-system-memory");
    this.memoryFile = path.join(this.memoryDir, "memories.jsonl");
  }

  async searchRelevant({ task, stage, plan }) {
    const entries = await this.readEntries();
    if (entries.length === 0) {
      return [];
    }

    const query = buildQuery(task, stage, plan);
    const queryEmbedding = await generateEmbedding(query);
    const queryTokens = tokenize(query);

    const scored = entries
      .map((entry) => ({ 
        entry, 
        score: scoreEntry(entry, queryTokens, queryEmbedding, stage) 
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, this.config.max_results ?? 4)
      .map(({ entry, score }) => ({
        id: entry.id,
        kind: entry.kind,
        createdAt: entry.createdAt,
        score,
        summary: entry.summary,
        files: entry.changedFiles ?? [],
        task: entry.task,
        outcome: entry.outcome
      }));

    return scored;
  }

  formatForPrompt(memories, stage) {
    if (!Array.isArray(memories) || memories.length === 0) {
      return "";
    }

    const lines = [
      `Relevant project memories for ${stage}:`,
      "Use these only when they are directly relevant to the current task."
    ];

    for (const memory of memories) {
      const changedFiles = memory.files.length > 0 ? ` Changed files: ${memory.files.join(", ")}.` : "";
      lines.push(
        `- [${memory.outcome}] ${memory.task} Summary: ${memory.summary}${changedFiles}`
      );
    }

    const joined = lines.join("\n");
    return joined.length <= (this.config.max_prompt_chars ?? 1600)
      ? joined
      : joined.slice(0, (this.config.max_prompt_chars ?? 1600) - 3) + "...";
  }

  async storeRunSummary({ task, plan, result, iterations, issueCounts, providers, success, dryRun }) {
    const summary = summarizeRun(result, iterations);
    const embedding = await generateEmbedding(`${task} ${summary}`);

    const entry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      kind: "run-summary",
      outcome: dryRun ? "dry-run" : success ? "success" : "failure",
      task,
      summary,
      embedding,
      changedFiles: result?.files?.map((file) => file.path) ?? [],
      readFiles: plan?.readFiles ?? [],
      writeTargets: plan?.writeTargets ?? [],
      issueCounts: issueCounts ?? { high: 0, medium: 0, low: 0 },
      providers,
      text: buildMemoryText({ task, plan, result, iterations, issueCounts, providers, success, dryRun })
    };

    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.appendFile(this.memoryFile, `${JSON.stringify(entry)}\n`, "utf8");
    await this.trimIfNeeded();
    return true;
  }

  async readEntries() {
    try {
      const raw = await fs.readFile(this.memoryFile, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry && typeof entry === "object");
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }

      this.logger?.warn(`Memory read failed: ${error.message}`);
      return [];
    }
  }

  async trimIfNeeded() {
    const maxEntries = this.config.max_entries ?? 500;
    const entries = await this.readEntries();
    if (entries.length <= maxEntries) {
      return;
    }

    const trimmed = entries.slice(entries.length - maxEntries);
    await fs.writeFile(this.memoryFile, `${trimmed.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  }
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

function scoreEntry(entry, queryTokens, queryEmbedding, stage) {
  const entryTokens = tokenize(
    [
      entry.task,
      entry.summary,
      entry.text,
      ...(entry.changedFiles ?? []),
      ...(entry.writeTargets ?? [])
    ]
      .filter(Boolean)
      .join(" ")
  );

  let keywordScore = 0;
  for (const token of queryTokens) {
    if (entryTokens.has(token)) {
      keywordScore += 1;
    }
  }

  // Semantic similarity score (normalized to roughly match keyword impact)
  let semanticScore = 0;
  if (queryEmbedding && entry.embedding) {
    const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
    // Weight semantic similarity higher if it's a strong match
    semanticScore = similarity > 0.7 ? similarity * 10 : similarity * 5;
  }

  const recencyBonus = computeRecencyBonus(entry.createdAt);
  const stageBonus = entry.kind === "run-summary" ? 0.5 : 0;
  
  return keywordScore + semanticScore + recencyBonus + stageBonus + (stage ? 0.1 : 0);
}

function tokenize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function computeRecencyBonus(createdAt) {
  const ageMs = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return 0;
  }

  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.max(2 - ageDays / 7, 0);
}

function summarizeRun(result, iterations) {
  const changedFiles = result?.files?.map((file) => file.path) ?? [];
  const latestSummary = iterations?.at(-1)?.summary ?? "No review summary available.";
  return changedFiles.length > 0
    ? `${latestSummary} Changed files: ${changedFiles.join(", ")}.`
    : latestSummary;
}

function buildMemoryText({ task, plan, result, iterations, issueCounts, providers, success, dryRun }) {
  return [
    `Task: ${task}`,
    `Outcome: ${dryRun ? "dry-run" : success ? "success" : "failure"}`,
    `Read files: ${(plan?.readFiles ?? []).join(", ") || "(none)"}`,
    `Write targets: ${(plan?.writeTargets ?? []).join(", ") || "(none)"}`,
    `Changed files: ${(result?.files?.map((file) => file.path) ?? []).join(", ") || "(none)"}`,
    `Issue counts: high=${issueCounts?.high ?? 0}, medium=${issueCounts?.medium ?? 0}, low=${issueCounts?.low ?? 0}`,
    `Providers: planner=${providers?.planner}, reviewer=${providers?.reviewer}, generator=${providers?.generator}, fixer=${providers?.fixer}`,
    `Review summaries: ${(iterations ?? []).map((iteration) => iteration.summary).filter(Boolean).join(" | ") || "(none)"}`
  ].join("\n");
}
