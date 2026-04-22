import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createArtifactState,
  finalizeArtifactState,
  loadSavedContextArtifacts,
  persistContextArtifacts,
  persistIterationArtifacts,
  persistPlanArtifacts,
  persistRunState,
  resolveResumeStatePath,
  restoreArtifactState
} from "../ai-system/core/artifacts.js";
import type { FileGenerationResult, IterationResult, MemoryStats, PlanResult, ProviderSummary, ReviewIssue, RulesConfig } from "../ai-system/types.js";

test("artifact checkpoints can be restored into resume-ready state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-artifacts-"));
  const rules = createRules();
  const plan: PlanResult = {
    prompt: "Implement checkpoint persistence",
    readFiles: ["src/existing.ts", "src/missing.ts"],
    writeTargets: ["src/generated.ts"],
    notes: ["Keep artifacts resumable"]
  };
  const contextFiles = [{ path: "src/existing.ts", content: "export const existing = true;\n" }];
  const skippedFiles = ["src/missing.ts"];
  const issues: ReviewIssue[] = [
    {
      severity: "low",
      category: "style",
      path: "src/generated.ts",
      description: "Review accepted a low-severity issue",
      suggestedFix: "None"
    }
  ];
  const result: FileGenerationResult = {
    summary: "Generated a resumable candidate",
    files: [{ path: "src/generated.ts", action: "create", content: "export const generated = true;\n" }]
  };
  const iterations: IterationResult[] = [
    {
      iteration: 1,
      summary: "Checkpoint persisted",
      issues
    }
  ];
  const providers: ProviderSummary = {
    planner: "planner",
    reviewer: "reviewer",
    generator: "generator",
    fixer: "fixer"
  };
  const memory: MemoryStats = {
    backend: "local-file",
    planningMatches: 1,
    implementationMatches: 2,
    stored: false
  };

  try {
    const state = createArtifactState(tempDir, rules);

    await persistPlanArtifacts(state, {
      task: "checkpoint task",
      rawPlan: { prompt: plan.prompt },
      plan,
      provider: providers.planner
    });
    await persistContextArtifacts(state, {
      readFiles: plan.readFiles,
      skippedFiles,
      contexts: contextFiles
    });
    await persistIterationArtifacts(state, {
      iteration: 1,
      task: "checkpoint task",
      dryRun: true,
      plan,
      provider: providers.generator,
      resultSummary: result.summary,
      candidateFiles: result.files,
      originalFiles: [{ path: "src/generated.ts", content: null }],
      diffSummaries: [
        {
          path: "src/generated.ts",
          beforeLineCount: 0,
          afterLineCount: 1,
          addedLines: 1,
          removedLines: 0,
          changedLineEstimate: 1
        }
      ],
      preReviewIssues: [],
      reviewSummary: "Looks resumable",
      issues
    });

    const artifacts = finalizeArtifactState(state, result, false);
    assert.ok(artifacts);

    const statePath = await persistRunState(state, {
      status: "paused_after_generate",
      task: "checkpoint task",
      dryRun: true,
      repoRoot: tempDir,
      configPath: null,
      plan,
      result,
      iterations,
      skippedContextFiles: skippedFiles,
      finalIssues: issues,
      providers,
      memory,
      artifacts,
      wroteFiles: false,
      pauseAfterGenerate: true,
      latestReviewSummary: "Looks resumable"
    });

    assert.equal(typeof statePath, "string");
    assert.equal(await resolveResumeStatePath(tempDir, rules, "last"), statePath);

    const saved = JSON.parse(await fs.readFile(statePath as string, "utf8")) as { artifacts: typeof artifacts; status: string };
    assert.equal(saved.status, "paused_after_generate");

    const restored = restoreArtifactState(tempDir, rules, saved.artifacts, statePath as string);
    const restoredContexts = await loadSavedContextArtifacts(restored, plan.readFiles);
    const timelineRaw = await fs.readFile(path.join(state.runDir as string, "timeline.jsonl"), "utf8");
    const timeline = timelineRaw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { step: string; status: string });
    const index = JSON.parse(await fs.readFile(path.join(state.runDir as string, "artifact-index.json"), "utf8")) as {
      latestStatus: string;
      latestStep: string;
      iterationCount: number;
      stepPaths: Record<string, string>;
    };

    assert.deepEqual(restoredContexts, contextFiles);
    assert.equal(restored.runDir, state.runDir);
    assert.equal(restored.stepPaths.plan, state.stepPaths.plan);
    assert.equal(restored.stepPaths.context, state.stepPaths.context);
    assert.equal(restored.latestIterationPath, state.latestIterationPath);
    assert.deepEqual(
      timeline.map((entry) => entry.step),
      ["01-plan", "02-context", "iteration-1", "run-state"]
    );
    assert.equal(index.latestStatus, "paused_after_generate");
    assert.equal(index.latestStep, "run-state");
    assert.equal(index.iterationCount, 1);
    assert.ok(index.stepPaths.timeline);
    assert.ok(index.stepPaths.index);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveResumeStatePath('last') returns the newest resumable run", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-resume-last-"));
  const rules = createRules();
  const artifactsDir = path.join(tempDir, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
  const earlierRunDir = path.join(artifactsDir, "run-2026-04-22T10-00-00-000Z-aaaaaa");
  const laterRunDir = path.join(artifactsDir, "run-2026-04-22T10-05-00-000Z-bbbbbb");

  try {
    await fs.mkdir(earlierRunDir, { recursive: true });
    await fs.mkdir(laterRunDir, { recursive: true });
    await fs.writeFile(path.join(earlierRunDir, "run-state.json"), JSON.stringify({ status: "paused_after_plan" }), "utf8");
    await fs.writeFile(path.join(laterRunDir, "run-state.json"), JSON.stringify({ status: "paused_after_generate" }), "utf8");

    assert.equal(
      await resolveResumeStatePath(tempDir, rules, "last"),
      path.join(laterRunDir, "run-state.json")
    );
    assert.equal(
      await resolveResumeStatePath(tempDir, rules, earlierRunDir),
      path.join(earlierRunDir, "run-state.json")
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function createRules(): RulesConfig {
  return {
    max_iterations: 3,
    max_files: 5,
    max_write_files: 8,
    token_limit_hint: 12000,
    max_context_bytes: 60000,
    request_timeout_ms: 60000,
    request_retries: 3,
    retry_base_delay_ms: 500,
    artifacts: {
      enabled: true,
      data_dir: ".ai-system-artifacts"
    },
    memory: {
      enabled: false,
      backend: "local-file"
    },
    providers: {
      planner: { type: "gemini-cli" },
      reviewer: { type: "gemini-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    }
  };
}
