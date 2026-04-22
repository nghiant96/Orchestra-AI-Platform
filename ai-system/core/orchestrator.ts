import fs from "node:fs/promises";
import readline from "node:readline/promises";
import {
  buildProjectTree,
  filterExistingSafeReadFiles,
  filterSafeWriteTargets
} from "./context.js";
import { hasBlockingIssues } from "./reviewer.js";
import { loadJsonIfExists, mergeConfig, resolveProjectConfigPath } from "../utils/config.js";
import { loadEnvironment } from "../utils/api.js";
import type {
  ContextFile,
  FileGenerationResult,
  IterationResult,
  Logger,
  MemoryAdapter,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  ProviderConfig,
  ReviewIssue,
  RulesConfig
} from "../types.js";
import {
  buildStoppedResult,
  createArtifactState,
  loadSavedContextArtifacts,
  persistPlanArtifacts,
  persistRunState,
  resolveResumeStatePath,
  restoreArtifactState,
  type PersistedRunState
} from "./artifacts.js";
import {
  createRuntimeDependencies,
  executeGenerationLoop,
  finalizeFailedRun,
  finalizeSuccessfulRun,
  loadImplementationMemoryContext,
  readAndPersistContext
} from "./run-executor.js";

export class Orchestrator {
  repoRoot: string;
  logger: Logger;
  configPath: string | null;

  constructor({ repoRoot, logger, configPath = null }: { repoRoot: string; logger: Logger; configPath?: string | null }) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.configPath = configPath;
  }

  async run(
    task: string,
    {
      dryRun = false,
      interactive = false,
      pauseAfterPlan = false,
      pauseAfterGenerate = false
    }: { dryRun?: boolean; interactive?: boolean; pauseAfterPlan?: boolean; pauseAfterGenerate?: boolean } = {}
  ): Promise<OrchestratorResult> {
    const repoRoot = await fs.realpath(this.repoRoot);
    await loadEnvironment(repoRoot);

    const { rules, configPath } = await loadRules(repoRoot, this.configPath);
    applyEnvOverrides(rules);
    const runtime = createRuntimeDependencies(repoRoot, rules, this.logger);

    const memoryStats: MemoryStats = {
      backend: runtime.memory.id,
      planningMatches: 0,
      implementationMatches: 0,
      stored: false
    };
    const artifactState = createArtifactState(repoRoot, rules);

    this.logger.step(`Building project tree for ${repoRoot}`);
    const treeString = await buildProjectTree(repoRoot, rules);

    const planningMemories = await safelySearchMemory(
      runtime.memory,
      { task, stage: "planning" },
      this.logger
    );
    memoryStats.planningMatches = planningMemories.length;
    const planningMemoryContext = runtime.memory.formatForPrompt(planningMemories, "planning");

    this.logger.step(`Planning relevant files with ${runtime.plannerProvider.id}`);
    const rawPlan = await runtime.planner.planTask(task, treeString, repoRoot, planningMemoryContext);
    const readFiles = await filterExistingSafeReadFiles(repoRoot, rawPlan.readFiles ?? [], rules, this.logger);
    const writeTargets = filterSafeWriteTargets(rawPlan.writeTargets ?? [], rules, this.logger);
    const plan: PlanResult = {
      prompt: typeof rawPlan.prompt === "string" ? rawPlan.prompt : task,
      readFiles,
      writeTargets,
      notes: Array.isArray(rawPlan.notes) ? rawPlan.notes : []
    };
    await persistPlanArtifacts(
      artifactState,
      {
        task,
        rawPlan,
        plan,
        provider: runtime.plannerProvider.id
      },
      this.logger
    );

    if (pauseAfterPlan) {
      const confirmed = await this.confirmCheckpoint(
        "Plan checkpoint saved. Review the plan artifact before continuing?",
        artifactState.stepPaths.plan
      );
      if (!confirmed) {
        this.logger.warn("Task paused by user after planner checkpoint.");
        const result = buildStoppedResult({
          status: "paused_after_plan",
          dryRun,
          repoRoot,
          configPath,
          plan,
          providers: runtime.providerSummary,
          memoryStats,
          artifactState
        });
        await persistRunState(
          artifactState,
          {
            ...result,
            task,
            pauseAfterPlan,
            pauseAfterGenerate,
            latestReviewSummary: ""
          },
          this.logger
        );
        return result;
      }
    }

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
          providers: runtime.providerSummary,
          memory: memoryStats,
          artifacts: null,
          wroteFiles: false
        };
      }
    }

    const implementationMemoryContext = await loadImplementationMemoryContext(runtime.memory, task, plan, memoryStats, this.logger);
    const { contextFiles, skippedFiles } = await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger);

    const loopExecution = await executeGenerationLoop({
      startIteration: 1,
      task,
      dryRun,
      pauseAfterPlan,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      implementationMemoryContext,
      runtime,
      memoryStats,
      artifactState,
      initialState: {
        currentResult: null,
        acceptedIssues: [],
        latestReviewSummary: "",
        iterationResults: []
      },
      contextFiles,
      rules,
      logger: this.logger,
      confirmCheckpoint: this.confirmCheckpoint.bind(this),
      successResultStatus: undefined,
      successPersistedStatus: "completed"
    });

    if (loopExecution.result) {
      return loopExecution.result;
    }

    return finalizeFailedRun({
      task,
      dryRun,
      pauseAfterPlan,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      runtime,
      memoryStats,
      artifactState,
      state: loopExecution.state,
      resultStatus: undefined,
      persistedStatus: "failed",
      logger: this.logger
    });
  }

  async resume(resumeTarget: string): Promise<OrchestratorResult> {
    const repoRoot = await fs.realpath(this.repoRoot);
    await loadEnvironment(repoRoot);

    const { rules, configPath } = await loadRules(repoRoot, this.configPath);
    applyEnvOverrides(rules);

    const statePath = await resolveResumeStatePath(repoRoot, rules, resumeTarget);
    const saved = JSON.parse(await fs.readFile(statePath, "utf8")) as PersistedRunState;
    if (!saved?.status || !String(saved.status).startsWith("paused_")) {
      throw new Error(`Resume target is not a paused run state: ${statePath}`);
    }
    const runtime = createRuntimeDependencies(repoRoot, rules, this.logger);

    const task = saved.task ?? "";
    const dryRun = saved.dryRun ?? false;
    const plan = saved.plan;
    let skippedFiles: string[] = saved.skippedContextFiles ?? [];
    let iterationResults: IterationResult[] = Array.isArray(saved.iterations) ? [...saved.iterations] : [];
    let currentResult: FileGenerationResult | null = saved.result ?? null;
    let acceptedIssues: ReviewIssue[] = Array.isArray(saved.finalIssues) ? saved.finalIssues : [];
    let latestReviewSummary = typeof saved.latestReviewSummary === "string" ? saved.latestReviewSummary : "";
    const pauseAfterGenerate = saved.pauseAfterGenerate === true;
    const artifactState = restoreArtifactState(repoRoot, rules, saved.artifacts, statePath);

    const memoryStats: MemoryStats = {
      backend: runtime.memory.id,
      planningMatches: saved.memory?.planningMatches ?? 0,
      implementationMatches: saved.memory?.implementationMatches ?? 0,
      stored: false
    };

    const implementationMemoryContext = await loadImplementationMemoryContext(runtime.memory, task, plan, memoryStats, this.logger);

    let contextFiles: ContextFile[] = await loadSavedContextArtifacts(artifactState, plan.readFiles ?? []);
    if (saved.status === "paused_after_plan" && contextFiles.length === 0) {
      const contextResult = await readAndPersistContext(repoRoot, plan, rules, artifactState, this.logger);
      contextFiles = contextResult.contextFiles;
      skippedFiles = contextResult.skippedFiles;
      currentResult = null;
      acceptedIssues = [];
      latestReviewSummary = "";
      iterationResults = [];
    }

    if (saved.status === "paused_after_generate" && currentResult && !hasBlockingIssues(acceptedIssues)) {
      return finalizeSuccessfulRun({
        task,
        dryRun,
        pauseAfterPlan: false,
        pauseAfterGenerate,
        repoRoot,
        configPath,
        plan,
        skippedFiles,
        runtime,
        memoryStats,
        artifactState,
        state: {
          currentResult,
          acceptedIssues,
          latestReviewSummary,
          iterationResults
        },
        resultStatus: "resumed_completed",
        persistedStatus: "resumed_completed",
        logger: this.logger
      });
    }

    const loopExecution = await executeGenerationLoop({
      startIteration: currentResult ? iterationResults.length + 1 : 1,
      task,
      dryRun,
      pauseAfterPlan: false,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      implementationMemoryContext,
      runtime,
      memoryStats,
      artifactState,
      initialState: {
        currentResult,
        acceptedIssues,
        latestReviewSummary,
        iterationResults
      },
      contextFiles,
      rules,
      logger: this.logger,
      confirmCheckpoint: this.confirmCheckpoint.bind(this),
      successResultStatus: "resumed_completed",
      successPersistedStatus: "resumed_completed"
    });

    if (loopExecution.result) {
      return loopExecution.result;
    }

    return finalizeFailedRun({
      task,
      dryRun,
      pauseAfterPlan: false,
      pauseAfterGenerate,
      repoRoot,
      configPath,
      plan,
      skippedFiles,
      runtime,
      memoryStats,
      artifactState,
      state: loopExecution.state,
      resultStatus: "failed",
      persistedStatus: "failed",
      logger: this.logger
    });
  }

  async confirmPlan(plan: PlanResult): Promise<boolean> {
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

  async confirmCheckpoint(message: string, artifactPath?: string | null): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.logger.info(`Skipping interactive checkpoint prompt because no TTY is available. Artifact: ${artifactPath}`);
      return true;
    }

    console.log(`\n--- Checkpoint ---`);
    console.log(message);
    if (artifactPath) {
      console.log(`Artifact: ${artifactPath}`);
    }
    console.log("Type 'y' to continue or anything else to stop here.");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      const answer = await rl.question("Continue? (y/n): ");
      return answer.toLowerCase().startsWith("y");
    } finally {
      rl.close();
    }
  }
}

async function safelySearchMemory(memory: MemoryAdapter, payload: Parameters<MemoryAdapter["searchRelevant"]>[0], logger?: Logger) {
  try {
    return await memory.searchRelevant(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory search failed: ${normalized.message}`);
    return [];
  }
}

async function loadRules(repoRoot: string, explicitConfigPath?: string | null): Promise<{ rules: RulesConfig; configPath: string | null }> {
  const rulesPath = new URL("../config/rules.json", import.meta.url);
  const raw = await fs.readFile(rulesPath, "utf8");
  const baseRules = JSON.parse(raw) as RulesConfig;
  const configPath = await resolveProjectConfigPath(repoRoot, explicitConfigPath);
  const projectRules = configPath ? await loadJsonIfExists<Partial<RulesConfig>>(configPath) : null;

  return {
    rules: mergeConfig(baseRules, projectRules),
    configPath
  };
}

function applyEnvOverrides(rules: RulesConfig): void {
  applySimpleProviderEnv(rules, process.env.AI_SYSTEM_PROVIDER);
  applySimpleMemoryEnv(rules, process.env.AI_SYSTEM_MEMORY);

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
      baseUrl:
        process.env.AI_SYSTEM_BASE_URL ||
        process.env.AI_SYSTEM_OPENAI_BASE_URL ||
        process.env.AI_SYSTEM_9ROUTER_BASE_URL,
      apiKey:
        process.env.AI_SYSTEM_API_KEY ||
        process.env.AI_SYSTEM_OPENAI_API_KEY ||
        process.env.AI_SYSTEM_9ROUTER_API_KEY,
      model:
        process.env.AI_SYSTEM_MODEL ||
        process.env.AI_SYSTEM_OPENAI_MODEL ||
        process.env.AI_SYSTEM_9ROUTER_MODEL
    }
  );
}

function applySimpleProviderEnv(rules: RulesConfig, provider?: string): void {
  const normalized = String(provider || "").trim().toLowerCase();
  if (!normalized) {
    return;
  }

  switch (normalized) {
    case "default":
    case "local":
    case "local-cli":
      rules.providers.planner.type = "gemini-cli";
      rules.providers.reviewer.type = "gemini-cli";
      rules.providers.generator.type = "codex-cli";
      rules.providers.fixer.type = "codex-cli";
      return;
    case "9router":
      rules.providers.planner.type = "openai-compatible";
      rules.providers.reviewer.type = "openai-compatible";
      rules.providers.generator.type = "openai-compatible";
      rules.providers.fixer.type = "openai-compatible";
      if (!process.env.AI_SYSTEM_BASE_URL && !process.env.AI_SYSTEM_OPENAI_BASE_URL && !process.env.AI_SYSTEM_9ROUTER_BASE_URL) {
        process.env.AI_SYSTEM_BASE_URL = "http://127.0.0.1:20128/v1";
      }
      return;
    case "openai-compatible":
    case "gemini-cli":
    case "claude-cli":
    case "codex-cli":
      rules.providers.planner.type = normalized;
      rules.providers.reviewer.type = normalized;
      rules.providers.generator.type = normalized;
      rules.providers.fixer.type = normalized;
      return;
    default:
      return;
  }
}

function applySimpleMemoryEnv(rules: RulesConfig, memoryValue?: string): void {
  const normalized = String(memoryValue || "").trim().toLowerCase();
  if (!normalized) {
    return;
  }

  switch (normalized) {
    case "off":
    case "false":
    case "disabled":
      rules.memory.enabled = false;
      return;
    case "local":
    case "local-file":
      rules.memory.enabled = true;
      rules.memory.backend = "local-file";
      return;
    case "openmemory":
      rules.memory.enabled = true;
      rules.memory.backend = "openmemory";
      return;
    default:
      return;
  }
}

function applyProviderOverride(providerConfig: ProviderConfig | undefined, timeoutMs?: string, retries?: string) {
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

function applyMonitorOverride(providerConfig: ProviderConfig | undefined, monitorIntervalMs?: string) {
  if (!providerConfig) {
    return;
  }

  if (typeof monitorIntervalMs !== "undefined") {
    providerConfig.monitor_interval_ms = Number(monitorIntervalMs);
  }
}

function applyOpenAICompatibleOverride(
  providerConfigs: Array<ProviderConfig | undefined>,
  { baseUrl, apiKey, model }: { baseUrl?: string; apiKey?: string; model?: string }
) {
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
