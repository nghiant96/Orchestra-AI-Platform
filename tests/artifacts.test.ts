import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createArtifactState,
  finalizeArtifactState,
  loadSavedContextArtifacts,
  loadRecentRunSummary,
  persistContextArtifacts,
  persistIterationArtifacts,
  persistPlanArtifacts,
  persistRoutingArtifacts,
  persistRunState,
  resolveResumeStatePath,
  restoreArtifactState
} from "../ai-system/core/artifacts.js";
import { buildExecutionSummary } from "../ai-system/core/execution-summary.js";
import type {
  FileGenerationResult,
  IterationResult,
  MemoryStats,
  PlanResult,
  ProviderSummary,
  ReviewIssue,
  RoutingDecision,
  RulesConfig,
  ToolExecutionResult
} from "../ai-system/types.js";

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
  const toolResults: ToolExecutionResult[] = [
    {
      name: "lint",
      kind: "command",
      ok: true,
      skipped: false,
      issueCount: 0,
      durationMs: 15,
      summary: "lint passed.",
      command: "npm",
      args: ["run", "lint"],
      exitCode: 0
    }
  ];

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
      toolResults,
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

    const saved = JSON.parse(await fs.readFile(statePath as string, "utf8")) as {
      artifacts: typeof artifacts;
      status: string;
      execution?: { failure?: { class?: string } | null };
    };
    assert.equal(saved.status, "paused_after_generate");
    assert.equal(saved.execution?.failure?.class, "paused");

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
      latestToolResults: ToolExecutionResult[];
      stepPaths: Record<string, string>;
      execution?: { failure?: { class?: string } | null };
    };
    const iterationManifest = JSON.parse(
      await fs.readFile(path.join(state.latestIterationPath as string, "manifest.json"), "utf8")
    ) as { toolResults: ToolExecutionResult[] };

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
    assert.equal(index.latestToolResults.length, 0);
    assert.equal(index.execution?.failure?.class, "paused");
    assert.equal(iterationManifest.toolResults.length, 1);
    assert.equal(iterationManifest.toolResults[0]?.name, "lint");
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

test("persistRoutingArtifacts writes stage-specific routing manifests", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-routing-artifacts-"));
  const rules = createRules();
  const state = createArtifactState(tempDir, rules);
  const decision: RoutingDecision = {
    stage: "implementation",
    enabled: true,
    profile: "safe",
    reason: "Plan targets risky paths.",
    roleProviders: {
      planner: "gemini-cli",
      reviewer: "claude-cli",
      generator: "codex-cli",
      fixer: "codex-cli"
    },
    appliedRoles: {},
    reasons: ["Plan targets risky paths."],
    signals: [
      {
        name: "plan:risky-paths",
        matched: true,
        details: "Plan targets auth/session.ts.",
        scores: { safe: 4 }
      }
    ]
  };

  try {
    const artifactPath = await persistRoutingArtifacts(
      state,
      {
        stage: decision.stage,
        task: "Update auth session handling",
        decision
      }
    );
    assert.equal(typeof artifactPath, "string");
    const saved = JSON.parse(await fs.readFile(artifactPath as string, "utf8")) as { stage: string; decision: RoutingDecision };

    assert.equal(saved.stage, "implementation");
    assert.equal(saved.decision.profile, "safe");
    assert.equal(state.stepPaths["routing-implementation"], artifactPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadRecentRunSummary returns latest run state, index, and routing details", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-recent-run-"));
  const rules = createRules();
  const state = createArtifactState(tempDir, rules);
  const plan: PlanResult = {
    prompt: "Update auth session handling",
    readFiles: ["src/auth.ts"],
    writeTargets: ["src/auth.ts"],
    notes: []
  };
  const result: FileGenerationResult = {
    summary: "Updated auth session handling",
    files: [{ path: "src/auth.ts", action: "update", content: "export const auth = true;\n" }]
  };
  const providers: ProviderSummary = {
    planner: "gemini-cli",
    reviewer: "claude-cli",
    generator: "codex-cli",
    fixer: "codex-cli"
  };
  const memory: MemoryStats = {
    backend: "openmemory",
    planningMatches: 1,
    implementationMatches: 1,
    stored: true
  };
  const toolResults: ToolExecutionResult[] = [
    {
      name: "typecheck",
      kind: "command",
      ok: false,
      skipped: false,
      issueCount: 1,
      durationMs: 42,
      summary: "typecheck failed.",
      command: "pnpm",
      args: ["run", "typecheck"],
      exitCode: 1
    }
  ];
  const planningDecision: RoutingDecision = {
    stage: "planning",
    enabled: true,
    profile: "balanced",
    reason: "score-based routing",
    roleProviders: {
      planner: "gemini-cli",
      reviewer: "gemini-cli",
      generator: "codex-cli",
      fixer: "codex-cli"
    },
    appliedRoles: {},
    reasons: ["Repository contains tsconfig.json."],
    signals: []
  };
  const implementationDecision: RoutingDecision = {
    stage: "implementation",
    enabled: true,
    profile: "safe",
    reason: "Plan targets risky paths.",
    roleProviders: {
      planner: "gemini-cli",
      reviewer: "claude-cli",
      generator: "codex-cli",
      fixer: "codex-cli"
    },
    appliedRoles: { reviewer: "claude-cli" },
    reasons: ["Plan targets auth/session.ts."],
    signals: []
  };
  const execution = buildExecutionSummary({
    status: "failed",
    steps: [
      { name: "planner", durationMs: 18, status: "completed", detail: "Planner generated a plan." },
      { name: "iteration-1", durationMs: 42, status: "completed", detail: "Blocking issues remained." }
    ],
    finalIssues: [
      {
        severity: "medium",
        category: "tool:typecheck",
        path: "",
        description: "typecheck failed",
        suggestedFix: "Fix it"
      }
    ],
    latestToolResults: toolResults,
    iterations: [{ iteration: 1, summary: "Typecheck failed", issues: [] }]
  });

  try {
    await persistRoutingArtifacts(state, {
      stage: "planning",
      task: "Update auth session handling",
      decision: planningDecision
    });
    await persistRoutingArtifacts(state, {
      stage: "implementation",
      task: "Update auth session handling",
      decision: implementationDecision
    });
    const artifacts = finalizeArtifactState(state, result, false, toolResults, execution);
    await persistRunState(state, {
      status: "failed",
      task: "Update auth session handling",
      dryRun: true,
      repoRoot: tempDir,
      configPath: null,
      plan,
      result,
      iterations: [],
      skippedContextFiles: [],
      finalIssues: [
        {
          severity: "medium",
          category: "tool:typecheck",
          path: "",
          description: "typecheck failed",
          suggestedFix: "Fix it"
        }
      ],
      providers,
      memory,
      artifacts,
      wroteFiles: false,
      latestReviewSummary: "Typecheck failed after generation",
      latestToolResults: toolResults,
      execution
    });

    const summary = await loadRecentRunSummary(tempDir, rules, "last");

    assert.equal(summary.runState.status, "failed");
    assert.equal(summary.runState.task, "Update auth session handling");
    assert.equal(summary.artifactIndex?.latestStatus, "failed");
    assert.equal(summary.artifactIndex?.latestToolResults?.length, 1);
    assert.equal(summary.artifactIndex?.execution?.failure?.class, "tool-check-failed");
    assert.equal(summary.routing.planning?.profile, "balanced");
    assert.equal(summary.routing.implementation?.profile, "safe");
    assert.equal(summary.runState.latestToolResults?.[0]?.name, "typecheck");
    assert.equal(summary.runState.execution?.totalDurationMs, 60);
    assert.equal(summary.runState.execution?.failure?.class, "tool-check-failed");
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
