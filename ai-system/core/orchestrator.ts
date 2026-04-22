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
import type {
  ArtifactSummary,
  ContextFile,
  FileGenerationResult,
  GeneratedFile,
  IterationResult,
  Logger,
  MemoryAdapter,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  ProviderConfig,
  ProviderSummary,
  ReviewIssue,
  RunStatus,
  RulesConfig
} from "../types.js";

interface ArtifactState {
  enabled: boolean;
  repoRoot: string;
  baseDir: string;
  runDir: string | null;
  latestIterationPath: string | null;
  stepPaths: Record<string, string>;
}

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

    const plannerProvider = createProvider("planner", rules, this.logger);
    const reviewerProvider = createProvider("reviewer", rules, this.logger);
    const generatorProvider = createProvider("generator", rules, this.logger);
    const fixerProvider = createProvider("fixer", rules, this.logger);

    const planner = new PlannerAgent({ provider: plannerProvider, rules });
    const reviewer = new ReviewerAgent({ provider: reviewerProvider, rules });
    const generator = new GeneratorAgent({ provider: generatorProvider, rules });
    const fixer = new FixerAgent({ provider: fixerProvider, rules });
    const memory = createMemoryAdapter({ repoRoot, rules, logger: this.logger });

    const memoryStats: MemoryStats = {
      backend: memory.id,
      planningMatches: 0,
      implementationMatches: 0,
      stored: false
    };
    const artifactState = createArtifactState(repoRoot, rules);

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
    let latestReviewSummary = "";

    const rawPlan = await planner.planTask(task, treeString, repoRoot, planningMemoryContext);
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
        provider: plannerProvider.id
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
          providers: { plannerProvider, reviewerProvider, generatorProvider, fixerProvider },
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
            latestReviewSummary
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
          providers: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider }),
          memory: memoryStats,
          artifacts: null,
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
    await persistContextArtifacts(
      artifactState,
      {
        readFiles: plan.readFiles,
        skippedFiles,
        contexts: contextFiles
      },
      this.logger
    );

    const iterationResults: IterationResult[] = [];
    let currentResult: FileGenerationResult | null = null;
    let acceptedIssues: ReviewIssue[] = [];

    for (let iteration = 1; iteration <= rules.max_iterations; iteration += 1) {
      this.logger.step(`Generation loop ${iteration}/${rules.max_iterations}`);
      if (iteration === 1) {
        currentResult = await generator.generateCode(task, plan, contextFiles, repoRoot, implementationMemoryContext);
      } else {
        if (!currentResult) {
          throw new Error("Missing generation result before fixer iteration.");
        }
        currentResult = await fixer.fixCode(
          task,
          plan,
          currentResult.files,
          latestReviewSummary,
          acceptedIssues,
          repoRoot,
          implementationMemoryContext
        );
      }

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
      const artifactInfo = await persistIterationArtifacts(
        artifactState,
        {
          iteration,
          task,
          dryRun,
          plan,
          provider: iteration === 1 ? generatorProvider.id : fixerProvider.id,
          resultSummary: currentResult.summary ?? "",
          candidateFiles: currentResult.files,
          originalFiles,
          diffSummaries,
          preReviewIssues,
          reviewSummary: review.summary,
          issues: acceptedIssues
        },
        this.logger
      );
      iterationResults.push({
        iteration,
        summary: review.summary,
        issues: acceptedIssues,
        artifactPath: artifactInfo?.iterationPath ?? null
      });

      if (pauseAfterGenerate) {
        const confirmed = await this.confirmCheckpoint(
          `Generation checkpoint saved for iteration ${iteration}. Review the candidate files before continuing?`,
          artifactInfo?.iterationPath ?? artifactState.latestIterationPath
        );
        if (!confirmed) {
          this.logger.warn("Task paused by user after generation checkpoint.");
          const result = buildStoppedResult({
            status: "paused_after_generate",
            dryRun,
            repoRoot,
            configPath,
            plan,
            result: currentResult,
            iterations: iterationResults,
            skippedContextFiles: skippedFiles,
            finalIssues: acceptedIssues,
            providers: { plannerProvider, reviewerProvider, generatorProvider, fixerProvider },
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
              latestReviewSummary
            },
            this.logger
          );
          return result;
        }
      }

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

        const result: OrchestratorResult = {
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
          artifacts: finalizeArtifactState(artifactState, currentResult, true),
          wroteFiles: !dryRun
        };
        await persistRunState(
          artifactState,
          {
            ...result,
            status: "completed",
            task,
            pauseAfterPlan,
            pauseAfterGenerate,
            latestReviewSummary
          },
          this.logger
        );
        return result;
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

    const result: OrchestratorResult = {
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
      artifacts: finalizeArtifactState(artifactState, currentResult, false),
      wroteFiles: false
    };
    await persistRunState(
      artifactState,
      {
        ...result,
        status: "failed",
        task,
        pauseAfterPlan,
        pauseAfterGenerate,
        latestReviewSummary
      },
      this.logger
    );
    return result;
  }

  async resume(resumeTarget: string): Promise<OrchestratorResult> {
    const repoRoot = await fs.realpath(this.repoRoot);
    await loadEnvironment(repoRoot);

    const { rules, configPath } = await loadRules(repoRoot, this.configPath);
    applyEnvOverrides(rules);

    const statePath = await resolveResumeStatePath(repoRoot, rules, resumeTarget);
    const saved = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (!saved?.status || !String(saved.status).startsWith("paused_")) {
      throw new Error(`Resume target is not a paused run state: ${statePath}`);
    }

    const plannerProvider = createProvider("planner", rules, this.logger);
    const reviewerProvider = createProvider("reviewer", rules, this.logger);
    const generatorProvider = createProvider("generator", rules, this.logger);
    const fixerProvider = createProvider("fixer", rules, this.logger);

    const reviewer = new ReviewerAgent({ provider: reviewerProvider, rules });
    const generator = new GeneratorAgent({ provider: generatorProvider, rules });
    const fixer = new FixerAgent({ provider: fixerProvider, rules });
    const memory = createMemoryAdapter({ repoRoot, rules, logger: this.logger });

    const task = saved.task;
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
      backend: memory.id,
      planningMatches: saved.memory?.planningMatches ?? 0,
      implementationMatches: saved.memory?.implementationMatches ?? 0,
      stored: false
    };

    const implementationMemories = await safelySearchMemory(
      memory,
      { task, stage: "implementation", plan },
      this.logger
    );
    memoryStats.implementationMatches = implementationMemories.length;
    const implementationMemoryContext = memory.formatForPrompt(implementationMemories, "implementation");

    let contextFiles: ContextFile[] = await loadSavedContextArtifacts(artifactState, plan.readFiles ?? []);
    if (saved.status === "paused_after_plan" && contextFiles.length === 0) {
      this.logger.step(`Reading ${plan.readFiles.length} file(s) of context`);
      const contextResult = await readContextFiles(repoRoot, plan.readFiles, rules, this.logger);
      contextFiles = contextResult.contexts;
      skippedFiles = contextResult.skippedFiles;
      await persistContextArtifacts(
        artifactState,
        {
          readFiles: plan.readFiles,
          skippedFiles,
          contexts: contextFiles
        },
        this.logger
      );
      currentResult = null;
      acceptedIssues = [];
      latestReviewSummary = "";
      iterationResults = [];
    }

    if (saved.status === "paused_after_generate" && currentResult && !hasBlockingIssues(acceptedIssues)) {
      const originals = await readOriginalFiles(
        repoRoot,
        currentResult.files.map((file) => file.path)
      );

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

      const result: OrchestratorResult = {
        ok: true,
        status: "resumed_completed",
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
        artifacts: finalizeArtifactState(artifactState, currentResult, true),
        wroteFiles: !dryRun
      };
      await persistRunState(
        artifactState,
        {
          ...result,
          task,
          pauseAfterPlan: false,
          pauseAfterGenerate,
          latestReviewSummary
        },
        this.logger
      );
      return result;
    }

    const startIteration = currentResult ? iterationResults.length + 1 : 1;

    for (let iteration = startIteration; iteration <= rules.max_iterations; iteration += 1) {
      this.logger.step(`Generation loop ${iteration}/${rules.max_iterations} (resumed)`);
      if (iteration === 1 && !currentResult) {
        currentResult = await generator.generateCode(task, plan, contextFiles, repoRoot, implementationMemoryContext);
      } else {
        if (!currentResult) {
          throw new Error("Missing generation result before fixer iteration.");
        }
        currentResult = await fixer.fixCode(
          task,
          plan,
          currentResult.files,
          latestReviewSummary,
          acceptedIssues,
          repoRoot,
          implementationMemoryContext
        );
      }

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
      const artifactInfo = await persistIterationArtifacts(
        artifactState,
        {
          iteration,
          task,
          dryRun,
          plan,
          provider: iteration === 1 ? generatorProvider.id : fixerProvider.id,
          resultSummary: currentResult.summary ?? "",
          candidateFiles: currentResult.files,
          originalFiles,
          diffSummaries,
          preReviewIssues,
          reviewSummary: review.summary,
          issues: acceptedIssues
        },
        this.logger
      );
      iterationResults.push({
        iteration,
        summary: review.summary,
        issues: acceptedIssues,
        artifactPath: artifactInfo?.iterationPath ?? null
      });

      if (pauseAfterGenerate) {
        const confirmed = await this.confirmCheckpoint(
          `Generation checkpoint saved for iteration ${iteration}. Review the candidate files before continuing?`,
          artifactInfo?.iterationPath ?? artifactState.latestIterationPath
        );
        if (!confirmed) {
          this.logger.warn("Task paused by user after generation checkpoint.");
          const result = buildStoppedResult({
            status: "paused_after_generate",
            dryRun,
            repoRoot,
            configPath,
            plan,
            result: currentResult,
            iterations: iterationResults,
            skippedContextFiles: skippedFiles,
            finalIssues: acceptedIssues,
            providers: { plannerProvider, reviewerProvider, generatorProvider, fixerProvider },
            memoryStats,
            artifactState
          });
          await persistRunState(
            artifactState,
            {
              ...result,
              task,
              pauseAfterPlan: false,
              pauseAfterGenerate,
              latestReviewSummary
            },
            this.logger
          );
          return result;
        }
      }

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

        const result: OrchestratorResult = {
          ok: true,
          status: "resumed_completed",
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
          artifacts: finalizeArtifactState(artifactState, currentResult, true),
          wroteFiles: !dryRun
        };
        await persistRunState(
          artifactState,
          {
            ...result,
            task,
            pauseAfterPlan: false,
            pauseAfterGenerate,
            latestReviewSummary
          },
          this.logger
        );
        return result;
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

    const result: OrchestratorResult = {
      ok: false,
      status: "failed",
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
      artifacts: finalizeArtifactState(artifactState, currentResult, false),
      wroteFiles: false
    };
    await persistRunState(
      artifactState,
      {
        ...result,
        task,
        pauseAfterPlan: false,
        pauseAfterGenerate,
        latestReviewSummary
      },
      this.logger
    );
    return result;
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

function sanitizeGeneratedFiles(files: unknown, plan: PlanResult, rules: RulesConfig, repoRoot: string): GeneratedFile[] {
  const allowedTargets = new Set(plan.writeTargets);
  const safeFiles: GeneratedFile[] = [];

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

function dedupeByPath(files: GeneratedFile[]): GeneratedFile[] {
  const map = new Map<string, GeneratedFile>();
  for (const file of files) {
    map.set(file.path, file);
  }
  return [...map.values()];
}

function summarizeProviders({
  plannerProvider,
  reviewerProvider,
  generatorProvider,
  fixerProvider
}: {
  plannerProvider: { id: string };
  reviewerProvider: { id: string };
  generatorProvider: { id: string };
  fixerProvider: { id: string };
}): ProviderSummary {
  return {
    planner: plannerProvider.id,
    reviewer: reviewerProvider.id,
    generator: generatorProvider.id,
    fixer: fixerProvider.id
  };
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

async function safelyStoreMemory(memory: MemoryAdapter, payload: Parameters<MemoryAdapter["storeRunSummary"]>[0], logger?: Logger) {
  try {
    return await memory.storeRunSummary(payload);
  } catch (error) {
    const normalized = error as Error;
    logger?.warn(`Memory store failed: ${normalized.message}`);
    return false;
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

function buildStoppedResult({
  status,
  dryRun,
  repoRoot,
  configPath,
  plan,
  result = null,
  iterations = [],
  skippedContextFiles = [],
  finalIssues = [],
  providers,
  memoryStats,
  artifactState
}: {
  status: Extract<RunStatus, "paused_after_plan" | "paused_after_generate">;
  dryRun: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  result?: FileGenerationResult | null;
  iterations?: IterationResult[];
  skippedContextFiles?: string[];
  finalIssues?: ReviewIssue[];
  providers: {
    plannerProvider: { id: string };
    reviewerProvider: { id: string };
    generatorProvider: { id: string };
    fixerProvider: { id: string };
  };
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
}): OrchestratorResult {
  return {
    ok: false,
    status,
    dryRun,
    repoRoot,
    configPath,
    plan,
    result,
    iterations,
    issueCounts: summarizeIssueCounts(finalIssues),
    skippedContextFiles,
    finalIssues,
    providers: summarizeProviders(providers),
    memory: memoryStats,
    artifacts: finalizeArtifactState(artifactState, result, false),
    wroteFiles: false
  };
}

function createArtifactState(repoRoot: string, rules: RulesConfig): ArtifactState {
  const config = rules.artifacts ?? {};
  return {
    enabled: config.enabled !== false,
    repoRoot,
    baseDir: path.join(repoRoot, config.data_dir ?? ".ai-system-artifacts"),
    runDir: null,
    latestIterationPath: null,
    stepPaths: {}
  };
}

function restoreArtifactState(repoRoot: string, rules: RulesConfig, savedArtifacts: any, statePath: string): ArtifactState {
  const state = createArtifactState(repoRoot, rules);
  const runPath = savedArtifacts?.runPath
    ? path.resolve(savedArtifacts.runPath)
    : path.dirname(path.resolve(statePath));

  state.runDir = runPath;
  state.latestIterationPath = savedArtifacts?.latestIterationPath
    ? path.resolve(savedArtifacts.latestIterationPath)
    : null;
  state.stepPaths = normalizeStepPaths(savedArtifacts?.stepPaths ?? {}, runPath);
  return state;
}

async function persistPlanArtifacts(state: ArtifactState, payload: any, logger?: Logger) {
  if (!state?.enabled) {
    return null;
  }

  const stepPath = await ensureArtifactStepDirectory(state, "01-plan");
  const manifest = {
    savedAt: new Date().toISOString(),
    provider: payload.provider,
    task: payload.task,
    rawPlan: payload.rawPlan,
    normalizedPlan: payload.plan
  };
  await fs.writeFile(path.join(stepPath, "plan.json"), JSON.stringify(manifest, null, 2), "utf8");
  state.stepPaths.plan = stepPath;
  logger?.info(`Saved planner checkpoint at ${stepPath}`);
  return stepPath;
}

async function persistContextArtifacts(
  state: ArtifactState,
  payload: { readFiles: string[]; skippedFiles: string[]; contexts: ContextFile[] },
  logger?: Logger
) {
  if (!state?.enabled) {
    return null;
  }

  const stepPath = await ensureArtifactStepDirectory(state, "02-context");
  const filesRoot = path.join(stepPath, "files");
  await fs.mkdir(filesRoot, { recursive: true });

  for (const context of payload.contexts) {
    const targetPath = path.join(filesRoot, context.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, context.content, "utf8");
  }

  const manifest = {
    savedAt: new Date().toISOString(),
    readFiles: payload.readFiles,
    skippedFiles: payload.skippedFiles,
    savedFiles: payload.contexts.map((context) => context.path)
  };
  await fs.writeFile(path.join(stepPath, "context.json"), JSON.stringify(manifest, null, 2), "utf8");
  state.stepPaths.context = stepPath;
  logger?.info(`Saved context checkpoint at ${stepPath}`);
  return stepPath;
}

async function persistIterationArtifacts(state: ArtifactState, payload: any, logger?: Logger) {
  if (!state?.enabled) {
    return null;
  }

  if (!state.runDir) {
    state.runDir = path.join(state.baseDir, createRunDirectoryName());
  }

  const iterationPath = path.join(state.runDir, `iteration-${payload.iteration}`);
  const filesRoot = path.join(iterationPath, "files");
  await fs.mkdir(filesRoot, { recursive: true });

  for (const file of payload.candidateFiles) {
    const targetPath = path.join(filesRoot, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
  }

  const manifest = {
    iteration: payload.iteration,
    task: payload.task,
    dryRun: payload.dryRun,
    savedAt: new Date().toISOString(),
    provider: payload.provider,
    plan: {
      prompt: payload.plan?.prompt ?? "",
      readFiles: payload.plan?.readFiles ?? [],
      writeTargets: payload.plan?.writeTargets ?? [],
      notes: payload.plan?.notes ?? []
    },
    resultSummary: payload.resultSummary,
    candidateFiles: payload.candidateFiles.map((file: { path: string; action?: string }) => ({
      path: file.path,
      action: file.action
    })),
    originalFiles: payload.originalFiles.map((file: { path: string; content?: string | null }) => ({
      path: file.path,
      existed: file.content !== null
    })),
    diffSummaries: payload.diffSummaries,
    preReviewIssues: payload.preReviewIssues,
    reviewSummary: payload.reviewSummary,
    issues: payload.issues
  };

  await fs.writeFile(path.join(iterationPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  state.latestIterationPath = iterationPath;
  state.stepPaths[`iteration-${payload.iteration}`] = iterationPath;
  logger?.info(`Saved candidate artifacts for manual review at ${iterationPath}`);
  return { iterationPath, manifestPath: path.join(iterationPath, "manifest.json") };
}

async function persistRunState(state: ArtifactState, payload: any, logger?: Logger) {
  if (!state?.enabled || !state.runDir) {
    return null;
  }

  const statePath = path.join(state.runDir, "run-state.json");
  const serializable = {
    version: 1,
    status: payload.status ?? (payload.ok ? "completed" : "failed"),
    task: payload.task,
    dryRun: payload.dryRun,
    repoRoot: payload.repoRoot,
    configPath: payload.configPath,
    plan: payload.plan,
    result: payload.result,
    iterations: payload.iterations ?? [],
    skippedContextFiles: payload.skippedContextFiles ?? [],
    finalIssues: payload.finalIssues ?? [],
    issueCounts: payload.issueCounts ?? summarizeIssueCounts(payload.finalIssues ?? []),
    providers: payload.providers,
    memory: payload.memory,
    artifacts: payload.artifacts ?? finalizeArtifactState(state, payload.result, payload.ok),
    wroteFiles: payload.wroteFiles ?? false,
    pauseAfterPlan: payload.pauseAfterPlan ?? false,
    pauseAfterGenerate: payload.pauseAfterGenerate ?? false,
    latestReviewSummary: payload.latestReviewSummary ?? ""
  };

  await fs.writeFile(statePath, JSON.stringify(serializable, null, 2), "utf8");
  state.stepPaths.runState = statePath;
  logger?.info(`Saved resumable run state at ${statePath}`);
  return statePath;
}

function finalizeArtifactState(state: ArtifactState, currentResult: FileGenerationResult | null, ok: boolean) {
  if (!state?.enabled || !state.runDir) {
    return null;
  }

  return {
    enabled: true,
    ok,
    runPath: state.runDir,
    latestIterationPath: state.latestIterationPath,
    stepPaths: state.stepPaths,
    latestFiles: currentResult?.files?.map((file) => file.path) ?? []
  };
}

function createRunDirectoryName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${random}`;
}

async function ensureArtifactStepDirectory(state: ArtifactState, name: string): Promise<string> {
  if (!state.runDir) {
    state.runDir = path.join(state.baseDir, createRunDirectoryName());
  }

  const stepPath = path.join(state.runDir, name);
  await fs.mkdir(stepPath, { recursive: true });
  return stepPath;
}

async function resolveResumeStatePath(repoRoot: string, rules: RulesConfig, resumeTarget: string): Promise<string> {
  const target = String(resumeTarget || "").trim();
  if (!target) {
    throw new Error("Missing resume target.");
  }

  if (target === "last") {
    const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
    const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
    const runDirs = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
      .map((entry) => path.join(artifactsDir, entry.name))
      .sort((left, right) => right.localeCompare(left));

    for (const runDir of runDirs) {
      const statePath = path.join(runDir, "run-state.json");
      try {
        await fs.access(statePath);
        return statePath;
      } catch {
        continue;
      }
    }

    throw new Error(`No resumable runs found in ${artifactsDir}`);
  }

  const absoluteTarget = path.resolve(target);
  const stat = await fs.stat(absoluteTarget);
  if (stat.isDirectory()) {
    const statePath = path.join(absoluteTarget, "run-state.json");
    await fs.access(statePath);
    return statePath;
  }

  return absoluteTarget;
}

async function loadSavedContextArtifacts(state: ArtifactState, expectedPaths: string[]): Promise<ContextFile[]> {
  const contextDir = state?.stepPaths?.context ? path.join(state.stepPaths.context, "files") : null;
  if (!contextDir) {
    return [];
  }

  const contexts: ContextFile[] = [];
  for (const relativePath of expectedPaths) {
    const targetPath = path.join(contextDir, relativePath);
    try {
      const content = await fs.readFile(targetPath, "utf8");
      contexts.push({ path: relativePath, content });
    } catch {
      continue;
    }
  }

  return contexts;
}

function normalizeStepPaths(stepPaths: Record<string, unknown>, runPath: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(stepPaths)) {
    if (typeof value !== "string") {
      continue;
    }
    output[key] = path.isAbsolute(value) ? value : path.join(runPath, value);
  }
  return output;
}
