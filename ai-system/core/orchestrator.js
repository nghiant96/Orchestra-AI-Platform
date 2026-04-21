import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { PlannerAgent } from "../agents/planner.js";
import { GeneratorAgent } from "../agents/generator.js";
import { FixerAgent } from "../agents/fixer.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import {
  buildProjectTree,
  filterExistingSafeReadFiles,
  filterSafeWriteTargets,
  readContextFiles,
  readOriginalFiles,
  resolveRepoPath,
  writeFilesAtomically
} from "./context.js";
import {
  buildDiffSummaries,
  hasBlockingIssues,
  mergeIssues,
  normalizeReviewResult,
  summarizeIssueCounts,
  validateCandidateFiles
} from "./reviewer.js";
import { createProvider } from "../providers/registry.js";
import { createMemoryAdapter } from "../memory/registry.js";
import { loadJsonIfExists, mergeConfig, resolveProjectConfigPath } from "../utils/config.js";
import { loadEnvironment } from "../utils/api.js";
import { runStaticAnalysis } from "../utils/linter.js";

export class Orchestrator {
  constructor({ repoRoot, logger, configPath = null }) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.configPath = configPath;
  }

  async run(task, { dryRun = false, interactive = false } = {}) {
    const repoRoot = await fs.realpath(this.repoRoot);
    await loadEnvironment(repoRoot);

    const { rules, configPath } = await loadRules(repoRoot, this.configPath);
    applyEnvOverrides(rules);

    const plannerProvider = createProvider("planner", rules, this.logger);
    const reviewerProvider = createProvider("reviewer", rules, this.logger);
    const generatorProvider = createProvider("generator", rules, this.logger);
    const fixerProvider = createProvider("fixer", rules, this.logger);

    const planner = new PlannerAgent({ provider: plannerProvider, rules });
    const reviewer = new ReviewerAgent({ provider: reviewerProvider, rules });
    const generator = new GeneratorAgent({ provider: generatorProvider, rules });
    const fixer = new FixerAgent({ provider: fixerProvider, rules });
    const memory = createMemoryAdapter({ repoRoot, rules, logger: this.logger });

    const memoryStats = {
      backend: memory.id,
      planningMatches: 0,
      implementationMatches: 0,
      stored: false
    };

    this.logger.step(`Building project tree for ${repoRoot}`);
    const treeString = await buildProjectTree(repoRoot, rules);

    const planningMemories = await safelySearchMemory(
      memory,
      { task, stage: "planning" },
      this.logger
    );
    memoryStats.planningMatches = planningMemories.length;
    const planningMemoryContext = memory.formatForPrompt(planningMemories, "planning");

    this.logger.step(`Planning relevant files with ${plannerProvider.id}`);
    const rawPlan = await planner.planTask(task, treeString, repoRoot, planningMemoryContext);
    const readFiles = await filterExistingSafeReadFiles(repoRoot, rawPlan.readFiles ?? [], rules, this.logger);
    const writeTargets = filterSafeWriteTargets(rawPlan.writeTargets ?? [], rules, this.logger);
    const plan = {
      prompt: typeof rawPlan.prompt === "string" ? rawPlan.prompt : task,
      readFiles,
      writeTargets,
      notes: Array.isArray(rawPlan.notes) ? rawPlan.notes : []
    };

    if (interactive) {
      const confirmed = await this.confirmPlan(plan);
      if (!confirmed) {
        this.logger.warn("Task cancelled by user.");
        return {
          ok: false,
          status: "cancelled",
          dryRun,
          repoRoot,
          configPath,
          plan,
          result: null,
          iterations: [],
          issueCounts: { high: 0, medium: 0, low: 0 },
          skippedContextFiles: [],
          finalIssues: [],
          providers: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }),
          memory: memoryStats,
          wroteFiles: false
        };
      }
    }

    const implementationMemories = await safelySearchMemory(
      memory,
      { task, stage: "implementation", plan },
      this.logger
    );
    memoryStats.implementationMatches = implementationMemories.length;
    const implementationMemoryContext = memory.formatForPrompt(implementationMemories, "implementation");

    this.logger.step(`Reading ${plan.readFiles.length} file(s) of context`);
    const { contexts: contextFiles, skippedFiles } = await readContextFiles(repoRoot, plan.readFiles, rules, this.logger);

    const iterationResults = [];
    let currentResult = null;
    let acceptedIssues = [];
    let latestReviewSummary = "";

    for (let iteration = 1; iteration <= rules.max_iterations; iteration += 1) {
      this.logger.step(`Generation loop ${iteration}/${rules.max_iterations}`);
      currentResult =
        iteration === 1
          ? await generator.generateCode(task, plan, contextFiles, repoRoot, implementationMemoryContext)
          : await fixer.fixCode(
              task,
              plan,
              currentResult.files,
              latestReviewSummary,
              acceptedIssues,
              repoRoot,
              implementationMemoryContext
            );

      currentResult.files = sanitizeGeneratedFiles(currentResult.files, plan, rules, repoRoot);
      if (currentResult.files.length === 0) {
        throw new Error("Generator returned no safe files to write.");
      }

      const originals = await readOriginalFiles(
        repoRoot,
        currentResult.files.map((file) => file.path)
      );
      const originalFiles = currentResult.files.map((file) => ({
        path: file.path,
        content: originals.get(file.path)
      }));
      const diffSummaries = buildDiffSummaries(originalFiles, currentResult.files);

      const validationIssues = validateCandidateFiles(currentResult.files);
      const staticAnalysisIssues = await runStaticAnalysis(repoRoot, currentResult.files, this.logger);
      const preReviewIssues = mergeIssues(staticAnalysisIssues, validationIssues);

      this.logger.step(`Reviewing generated files with ${reviewerProvider.id}`);
      const review = normalizeReviewResult(
        await reviewer.reviewCode(
          task,
          originalFiles,
          currentResult.files,
          preReviewIssues,
          diffSummaries,
          repoRoot,
          implementationMemoryContext
        )
      );

      latestReviewSummary = review.summary;
      acceptedIssues = mergeIssues(review.issues, preReviewIssues);
      iterationResults.push({
        iteration,
        summary: review.summary,
        issues: acceptedIssues
      });

      if (!hasBlockingIssues(acceptedIssues)) {
        if (!dryRun) {
          this.logger.step("Writing files atomically");
          await writeFilesAtomically(repoRoot, currentResult.files, originals);
        }

        memoryStats.stored = await safelyStoreMemory(
          memory,
          {
            task,
            plan,
            result: currentResult,
            iterations: iterationResults,
            issueCounts: summarizeIssueCounts(acceptedIssues),
            providers: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }),
            success: true,
            dryRun
          },
          this.logger
        );

        return {
          ok: true,
          dryRun,
          repoRoot,
          configPath,
          plan,
          result: currentResult,
          iterations: iterationResults,
          issueCounts: summarizeIssueCounts(acceptedIssues),
          skippedContextFiles: skippedFiles,
          finalIssues: acceptedIssues,
          providers: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }),
          memory: memoryStats,
          wroteFiles: !dryRun
        };
      }
    }

    memoryStats.stored = await safelyStoreMemory(
      memory,
      {
        task,
        plan,
        result: currentResult,
        iterations: iterationResults,
        issueCounts: summarizeIssueCounts(acceptedIssues),
        providers: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }),
        success: false,
        dryRun
      },
      this.logger
    );

    return {
      ok: false,
      dryRun,
      repoRoot,
      configPath,
      plan,
      result: currentResult,
      iterations: iterationResults,
      issueCounts: summarizeIssueCounts(acceptedIssues),
      skippedContextFiles: skippedFiles,
      finalIssues: acceptedIssues,
      providers: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }),
      memory: memoryStats,
      wroteFiles: false
    };
  }

  async confirmPlan(plan) {
    console.log("\n--- Proposed Plan ---");
    console.log(`Prompt: ${plan.prompt}`);
    console.log(`Files to read:   ${plan.readFiles.length > 0 ? plan.readFiles.join(", ") : "(none)"}`);
    console.log(`Files to write:  ${plan.writeTargets.length > 0 ? plan.writeTargets.join(", ") : "(none)"}`);
    if (plan.notes.length > 0) {
      console.log("Notes:");
      plan.notes.forEach((note) => console.log(`  - ${note}`));
    }
    console.log("---------------------\n");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      const answer = await rl.question("Proceed with this plan? (y/n): ");
      return answer.toLowerCase().startsWith("y");
    } finally {
      rl.close();
    }
  }
}

async function loadRules(repoRoot, explicitConfigPath) {
  const rulesPath = new URL("../config/rules.json", import.meta.url);
  const raw = await fs.readFile(rulesPath, "utf8");
  const baseRules = JSON.parse(raw);
  const configPath = await resolveProjectConfigPath(repoRoot, explicitConfigPath);
  const projectRules = configPath ? await loadJsonIfExists(configPath) : null;

  return {
    rules: mergeConfig(baseRules, projectRules),
    configPath
  };
}

function applyEnvOverrides(rules) {
  if (process.env.AI_SYSTEM_MAX_ITERATIONS) {
    rules.max_iterations = Number(process.env.AI_SYSTEM_MAX_ITERATIONS);
  }
  if (process.env.AI_SYSTEM_MAX_FILES) {
    rules.max_files = Number(process.env.AI_SYSTEM_MAX_FILES);
  }
  if (process.env.AI_SYSTEM_TOKEN_LIMIT_HINT) {
    rules.token_limit_hint = Number(process.env.AI_SYSTEM_TOKEN_LIMIT_HINT);
  }
  if (process.env.AI_SYSTEM_PLANNER_PROVIDER) {
    rules.providers.planner.type = process.env.AI_SYSTEM_PLANNER_PROVIDER;
  }
  if (process.env.AI_SYSTEM_REVIEWER_PROVIDER) {
    rules.providers.reviewer.type = process.env.AI_SYSTEM_REVIEWER_PROVIDER;
  }
  if (process.env.AI_SYSTEM_GENERATOR_PROVIDER) {
    rules.providers.generator.type = process.env.AI_SYSTEM_GENERATOR_PROVIDER;
  }
  if (process.env.AI_SYSTEM_FIXER_PROVIDER) {
    rules.providers.fixer.type = process.env.AI_SYSTEM_FIXER_PROVIDER;
  }
  if (process.env.AI_SYSTEM_MEMORY_ENABLED) {
    rules.memory.enabled = process.env.AI_SYSTEM_MEMORY_ENABLED !== "false";
  }
  if (process.env.AI_SYSTEM_MEMORY_BACKEND) {
    rules.memory.backend = process.env.AI_SYSTEM_MEMORY_BACKEND;
  }
  if (process.env.AI_SYSTEM_MEMORY_TRANSPORT) {
    rules.memory.transport = process.env.AI_SYSTEM_MEMORY_TRANSPORT;
  }
  if (process.env.AI_SYSTEM_OPENMEMORY_BASE_URL) {
    rules.memory.base_url = process.env.AI_SYSTEM_OPENMEMORY_BASE_URL;
  }
  if (process.env.AI_SYSTEM_OPENMEMORY_API_KEY) {
    rules.memory.api_key = process.env.AI_SYSTEM_OPENMEMORY_API_KEY;
  }

  applyProviderOverride(rules.providers.planner, process.env.AI_SYSTEM_PLANNER_TIMEOUT_MS, process.env.AI_SYSTEM_PLANNER_RETRIES);
  applyProviderOverride(rules.providers.reviewer, process.env.AI_SYSTEM_REVIEWER_TIMEOUT_MS, process.env.AI_SYSTEM_REVIEWER_RETRIES);
  applyProviderOverride(rules.providers.generator, process.env.AI_SYSTEM_GENERATOR_TIMEOUT_MS, process.env.AI_SYSTEM_GENERATOR_RETRIES);
  applyProviderOverride(rules.providers.fixer, process.env.AI_SYSTEM_FIXER_TIMEOUT_MS, process.env.AI_SYSTEM_FIXER_RETRIES);

  applyMonitorOverride(rules.providers.planner, process.env.AI_SYSTEM_PLANNER_MONITOR_INTERVAL_MS);
  applyMonitorOverride(rules.providers.reviewer, process.env.AI_SYSTEM_REVIEWER_MONITOR_INTERVAL_MS);
  applyMonitorOverride(rules.providers.generator, process.env.AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS);
  applyMonitorOverride(rules.providers.fixer, process.env.AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS);

  applyOpenAICompatibleOverride(
    [rules.providers.planner, rules.providers.reviewer, rules.providers.generator, rules.providers.fixer],
    {
      baseUrl: process.env.AI_SYSTEM_OPENAI_BASE_URL || process.env.AI_SYSTEM_9ROUTER_BASE_URL,
      apiKey: process.env.AI_SYSTEM_OPENAI_API_KEY || process.env.AI_SYSTEM_9ROUTER_API_KEY,
      model: process.env.AI_SYSTEM_OPENAI_MODEL || process.env.AI_SYSTEM_9ROUTER_MODEL
    }
  );
}

function sanitizeGeneratedFiles(files, plan, rules, repoRoot) {
  const allowedTargets = new Set(plan.writeTargets);
  const safeFiles = [];

  for (const file of Array.isArray(files) ? files : []) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      continue;
    }

    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!normalizedPath || normalizedPath.includes("..") || path.isAbsolute(normalizedPath)) {
      continue;
    }

    if (allowedTargets.size > 0 && !allowedTargets.has(normalizedPath)) {
      continue;
    }

    resolveRepoPath(repoRoot, normalizedPath);
    safeFiles.push({
      path: normalizedPath,
      action: file.action === "create" ? "create" : "update",
      content: file.content
    });
  }

  return dedupeByPath(safeFiles).slice(0, rules.max_write_files ?? 8);
}

function dedupeByPath(files) {
  const map = new Map();
  for (const file of files) {
    map.set(file.path, file);
  }
  return [...map.values()];
}

function summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }) {
  return {
    planner: plannerProvider.id,
    reviewer: reviewerProvider.id,
    generator: generatorProvider.id,
    fixer: fixerProvider.id
  };
}

async function safelySearchMemory(memory, payload, logger) {
  try {
    return await memory.searchRelevant(payload);
  } catch (error) {
    logger?.warn(`Memory search failed: ${error.message}`);
    return [];
  }
}

async function safelyStoreMemory(memory, payload, logger) {
  try {
    return await memory.storeRunSummary(payload);
  } catch (error) {
    logger?.warn(`Memory store failed: ${error.message}`);
    return false;
  }
}

function applyProviderOverride(providerConfig, timeoutMs, retries) {
  if (!providerConfig) {
    return;
  }

  if (typeof timeoutMs !== "undefined") {
    providerConfig.timeout_ms = Number(timeoutMs);
  }

  if (typeof retries !== "undefined") {
    providerConfig.retries = Number(retries);
  }
}

function applyMonitorOverride(providerConfig, monitorIntervalMs) {
  if (!providerConfig) {
    return;
  }

  if (typeof monitorIntervalMs !== "undefined") {
    providerConfig.monitor_interval_ms = Number(monitorIntervalMs);
  }
}

function applyOpenAICompatibleOverride(providerConfigs, { baseUrl, apiKey, model }) {
  for (const providerConfig of providerConfigs) {
    if (!providerConfig || providerConfig.type !== "openai-compatible") {
      continue;
    }

    if (typeof baseUrl !== "undefined" && baseUrl !== "") {
      providerConfig.base_url = baseUrl;
    }
    if (typeof apiKey !== "undefined" && apiKey !== "") {
      providerConfig.api_key = apiKey;
    }
    if (typeof model !== "undefined" && model !== "") {
      providerConfig.model = model;
    }
  }
}
