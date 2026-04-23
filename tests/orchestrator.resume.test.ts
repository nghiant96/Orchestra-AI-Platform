import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Orchestrator } from "../ai-system/core/orchestrator.js";
import {
  createArtifactState,
  persistContextArtifacts,
  persistIterationArtifacts,
  persistPlanArtifacts,
  persistRunState
} from "../ai-system/core/artifacts.js";
import { loadRules } from "../ai-system/core/orchestrator-runtime.js";
import type { ArtifactSummary, Logger, PlanResult, ReviewIssue, RulesConfig } from "../ai-system/types.js";

test("Orchestrator.resume completes a paused plan by running generator and reviewer", async () => {
  const repo = await createTestRepo();
  const plan: PlanResult = {
    prompt: "Create the result file",
    readFiles: ["src/input.ts"],
    writeTargets: ["src/result.ts"],
    notes: ["resume from paused plan"]
  };

  try {
    await fs.writeFile(path.join(repo.repoRoot, "src/input.ts"), "export const input = 'context';\n", "utf8");
    const rules = await repo.loadMergedRules();
    const artifacts = createArtifactState(repo.repoRoot, rules);

    await persistPlanArtifacts(artifacts, {
      task: "Resume a paused plan",
      rawPlan: plan,
      plan,
      provider: "gemini-cli"
    });
    await persistRunState(artifacts, {
      status: "paused_after_plan",
      task: "Resume a paused plan",
      dryRun: false,
      repoRoot: repo.repoRoot,
      configPath: repo.configPath,
      plan,
      result: null,
      iterations: [],
      skippedContextFiles: [],
      finalIssues: [],
      providers: providerSummary(),
      memory: { backend: "disabled", planningMatches: 0, implementationMatches: 0, stored: false },
      wroteFiles: false,
      pauseAfterPlan: true,
      pauseAfterGenerate: false,
      latestReviewSummary: ""
    });

    const result = await repo.orchestrator.resume("last");

    assert.equal(result.ok, true);
    assert.equal(result.status, "resumed_completed");
    assert.equal(result.wroteFiles, true);
    assert.equal(result.iterations.length, 1);
    assert.deepEqual(await repo.readFakeRoles(), ["generator", "reviewer"]);
    assert.equal(
      await fs.readFile(path.join(repo.repoRoot, "src/result.ts"), "utf8"),
      "export const output = 'from-generator';\n"
    );

  const savedState = await repo.readSavedRunState();
  assert.equal(savedState.status, "resumed_completed");
  assert.ok(savedState.artifacts?.stepPaths?.context);
  } finally {
    await repo.cleanup();
  }
});

test("Orchestrator.resume re-enters the fixer loop when a paused generation has blocking issues", async () => {
  const repo = await createTestRepo();
  const plan: PlanResult = {
    prompt: "Fix the broken result file",
    readFiles: ["src/input.ts"],
    writeTargets: ["src/result.ts"],
    notes: ["resume from paused generation"]
  };
  const blockingIssue: ReviewIssue = {
    severity: "high",
    category: "correctness",
    path: "src/result.ts",
    description: "The saved candidate is broken.",
    suggestedFix: "Replace the broken content."
  };

  try {
    await fs.writeFile(path.join(repo.repoRoot, "src/input.ts"), "export const input = 'context';\n", "utf8");
    await fs.writeFile(path.join(repo.repoRoot, "src/result.ts"), "export const output = 'broken-after-resume';\n", "utf8");
    const rules = await repo.loadMergedRules();
    const artifacts = createArtifactState(repo.repoRoot, rules);

    await persistPlanArtifacts(artifacts, {
      task: "Resume a paused generation",
      rawPlan: plan,
      plan,
      provider: "gemini-cli"
    });
    await persistContextArtifacts(artifacts, {
      readFiles: plan.readFiles,
      skippedFiles: [],
      contexts: [{ path: "src/input.ts", content: "export const input = 'context';\n" }]
    });
    await persistIterationArtifacts(artifacts, {
      iteration: 1,
      task: "Resume a paused generation",
      dryRun: false,
      plan,
      provider: "gemini-cli",
      resultSummary: "Broken candidate",
      candidateFiles: [
        {
          path: "src/result.ts",
          action: "update",
          content: "export const output = 'broken-after-resume';\n"
        }
      ],
      originalFiles: [{ path: "src/result.ts", content: "export const output = 'broken-after-resume';\n" }],
      diffSummaries: [],
      preReviewIssues: [],
      reviewSummary: "Needs a fix",
      issues: [blockingIssue]
    });
    await persistRunState(artifacts, {
      status: "paused_after_generate",
      task: "Resume a paused generation",
      dryRun: false,
      repoRoot: repo.repoRoot,
      configPath: repo.configPath,
      plan,
      result: {
        summary: "Broken candidate",
        files: [
          {
            path: "src/result.ts",
            action: "update",
            content: "export const output = 'broken-after-resume';\n"
          }
        ]
      },
      iterations: [{ iteration: 1, summary: "Needs a fix", issues: [blockingIssue] }],
      skippedContextFiles: [],
      finalIssues: [blockingIssue],
      providers: providerSummary(),
      memory: { backend: "disabled", planningMatches: 0, implementationMatches: 0, stored: false },
      wroteFiles: false,
      pauseAfterGenerate: false,
      latestReviewSummary: "Needs a fix"
    });

    const result = await repo.orchestrator.resume("last");

    assert.equal(result.ok, true);
    assert.equal(result.status, "resumed_completed");
    assert.equal(result.iterations.length, 2);
    assert.deepEqual(await repo.readFakeRoles(), ["fixer", "reviewer"]);
    assert.equal(
      await fs.readFile(path.join(repo.repoRoot, "src/result.ts"), "utf8"),
      "export const output = 'fixed-after-resume';\n"
    );
    assert.deepEqual(result.finalIssues, []);

    const savedState = await repo.readSavedRunState();
    assert.equal(savedState.status, "resumed_completed");
    assert.equal(savedState.iterations?.length, 2);
  } finally {
    await repo.cleanup();
  }
});

test("Orchestrator.resume retries a failed run from tool/review stages without regenerating files", async () => {
  const repo = await createTestRepo();
  const plan: PlanResult = {
    prompt: "Review the existing candidate",
    readFiles: ["src/input.ts"],
    writeTargets: ["src/result.ts"],
    notes: ["retry failed review stage"]
  };

  try {
    await fs.writeFile(path.join(repo.repoRoot, "src/input.ts"), "export const input = 'context';\n", "utf8");
    const rules = await repo.loadMergedRules();
    const artifacts = createArtifactState(repo.repoRoot, rules);

    await persistPlanArtifacts(artifacts, {
      task: "Retry failed review stage",
      rawPlan: plan,
      plan,
      provider: "gemini-cli"
    });
    await persistContextArtifacts(artifacts, {
      readFiles: plan.readFiles,
      skippedFiles: [],
      contexts: [{ path: "src/input.ts", content: "export const input = 'context';\n" }]
    });
    await persistRunState(artifacts, {
      status: "failed",
      task: "Retry failed review stage",
      dryRun: false,
      repoRoot: repo.repoRoot,
      configPath: repo.configPath,
      plan,
      result: {
        summary: "Candidate ready for review",
        files: [
          {
            path: "src/result.ts",
            action: "create",
            content: "export const output = 'from-generator';\n"
          }
        ]
      },
      iterations: [],
      skippedContextFiles: [],
      finalIssues: [],
      providers: providerSummary(),
      memory: { backend: "disabled", planningMatches: 0, implementationMatches: 0, stored: false },
      wroteFiles: false,
      latestReviewSummary: "",
      latestToolResults: [],
      execution: {
        totalDurationMs: 10,
        steps: [{ name: "iteration-tools-1", durationMs: 10, status: "failed", detail: "Reviewer process crashed." }],
        transitions: [
          { stage: "iteration-tools", status: "entered", timestamp: new Date().toISOString(), iteration: 1 },
          {
            stage: "iteration-tools",
            status: "failed",
            timestamp: new Date().toISOString(),
            durationMs: 10,
            detail: "Reviewer process crashed.",
            iteration: 1
          }
        ],
        currentStage: null,
        terminalStage: "iteration-tools",
        failure: { class: "unknown", reason: "Reviewer process crashed." },
        retryHint: {
          stage: "iteration-tools",
          iteration: 1,
          reason: "Retry tool and review stages with the saved candidate."
        }
      }
    });

    const result = await repo.orchestrator.resume("last");

    assert.equal(result.ok, true);
    assert.equal(result.status, "resumed_completed");
    assert.deepEqual(await repo.readFakeRoles(), ["reviewer"]);
    assert.equal(
      await fs.readFile(path.join(repo.repoRoot, "src/result.ts"), "utf8"),
      "export const output = 'from-generator';\n"
    );
  } finally {
    await repo.cleanup();
  }
});

test("Orchestrator.resume retries a failed write stage without rerunning generator or reviewer", async () => {
  const repo = await createTestRepo();
  const plan: PlanResult = {
    prompt: "Write the saved result",
    readFiles: ["src/input.ts"],
    writeTargets: ["src/result.ts"],
    notes: ["retry failed write stage"]
  };

  try {
    await fs.writeFile(path.join(repo.repoRoot, "src/input.ts"), "export const input = 'context';\n", "utf8");
    const rules = await repo.loadMergedRules();
    const artifacts = createArtifactState(repo.repoRoot, rules);

    await persistPlanArtifacts(artifacts, {
      task: "Retry failed write stage",
      rawPlan: plan,
      plan,
      provider: "gemini-cli"
    });
    await persistContextArtifacts(artifacts, {
      readFiles: plan.readFiles,
      skippedFiles: [],
      contexts: [{ path: "src/input.ts", content: "export const input = 'context';\n" }]
    });
    await persistRunState(artifacts, {
      status: "failed",
      task: "Retry failed write stage",
      dryRun: false,
      repoRoot: repo.repoRoot,
      configPath: repo.configPath,
      plan,
      result: {
        summary: "Ready to write",
        files: [
          {
            path: "src/result.ts",
            action: "create",
            content: "export const output = 'from-generator';\n"
          }
        ]
      },
      iterations: [{ iteration: 1, summary: "Looks good", issues: [] }],
      skippedContextFiles: [],
      finalIssues: [],
      providers: providerSummary(),
      memory: { backend: "disabled", planningMatches: 0, implementationMatches: 0, stored: false },
      wroteFiles: false,
      latestReviewSummary: "Looks good",
      latestToolResults: [],
      execution: {
        totalDurationMs: 10,
        steps: [{ name: "write-files", durationMs: 10, status: "failed", detail: "Disk full." }],
        transitions: [
          { stage: "write-files", status: "entered", timestamp: new Date().toISOString() },
          {
            stage: "write-files",
            status: "failed",
            timestamp: new Date().toISOString(),
            durationMs: 10,
            detail: "Disk full."
          }
        ],
        currentStage: null,
        terminalStage: "write-files",
        failure: { class: "unknown", reason: "Disk full." },
        retryHint: {
          stage: "write-files",
          reason: "Retry the atomic write with the saved candidate."
        }
      }
    });

    const result = await repo.orchestrator.resume("last");

    assert.equal(result.ok, true);
    assert.equal(result.status, "resumed_completed");
    await assert.rejects(repo.readFakeRoles(), /ENOENT/);
    assert.equal(
      await fs.readFile(path.join(repo.repoRoot, "src/result.ts"), "utf8"),
      "export const output = 'from-generator';\n"
    );
  } finally {
    await repo.cleanup();
  }
});

async function createTestRepo(): Promise<{
  repoRoot: string;
  configPath: string;
  orchestrator: Orchestrator;
  cleanup: () => Promise<void>;
  loadMergedRules: () => Promise<RulesConfig>;
  readFakeRoles: () => Promise<string[]>;
  readSavedRunState: () => Promise<{ status?: string; iterations?: unknown[]; artifacts?: ArtifactSummary | null }>;
}> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-resume-integration-"));
  const fakeCliPath = path.join(repoRoot, "fake-gemini.cjs");
  const configPath = path.join(repoRoot, ".ai-system.test.json");

  await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify({ name: "resume-test", private: true }, null, 2), "utf8");
  await fs.writeFile(fakeCliPath, buildFakeCliScript(), "utf8");
  await fs.chmod(fakeCliPath, 0o755);
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        max_iterations: 3,
        request_retries: 0,
        memory: {
          enabled: false,
          backend: "local-file"
        },
        artifacts: {
          enabled: true,
          data_dir: ".ai-system-artifacts"
        },
        providers: {
          planner: { type: "gemini-cli", command: fakeCliPath, retries: 0, timeout_ms: 8000 },
          reviewer: { type: "gemini-cli", command: fakeCliPath, retries: 0, timeout_ms: 8000 },
          generator: { type: "gemini-cli", command: fakeCliPath, retries: 0, timeout_ms: 8000 },
          fixer: { type: "gemini-cli", command: fakeCliPath, retries: 0, timeout_ms: 8000 }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    repoRoot,
    configPath,
    orchestrator: new Orchestrator({ repoRoot, logger: silentLogger(), configPath }),
    cleanup: async () => {
      await fs.rm(repoRoot, { recursive: true, force: true });
    },
    loadMergedRules: async () => {
      const loaded = await loadRules(repoRoot, configPath);
      return loaded.rules;
    },
    readFakeRoles: async () => {
      const logPath = path.join(repoRoot, ".fake-ai-log.jsonl");
      const raw = await fs.readFile(logPath, "utf8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { role: string })
        .map((entry) => entry.role);
    },
    readSavedRunState: async () => {
      const statePath = path.join(repoRoot, ".ai-system-artifacts");
      const runDirs = (await fs.readdir(statePath))
        .filter((entry) => entry.startsWith("run-"))
        .sort();
      const latestRunDir = runDirs.at(-1);
      if (!latestRunDir) {
        throw new Error("Missing persisted run directory.");
      }

      return JSON.parse(await fs.readFile(path.join(statePath, latestRunDir, "run-state.json"), "utf8")) as {
        status?: string;
        iterations?: unknown[];
        artifacts?: ArtifactSummary | null;
      };
    }
  };
}

function buildFakeCliScript(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const promptIndex = args.indexOf("-p");
const prompt = promptIndex === -1 ? "" : String(args[promptIndex + 1] || "");
const logPath = path.join(process.cwd(), ".fake-ai-log.jsonl");

let role = "unknown";
if (prompt.includes("planning agent")) {
  role = "planner";
} else if (prompt.includes("code generation agent")) {
  role = "generator";
} else if (prompt.includes("code fix agent")) {
  role = "fixer";
} else if (prompt.includes("review agent")) {
  role = "reviewer";
}

fs.appendFileSync(logPath, JSON.stringify({ role }) + "\\n");

let output;
switch (role) {
  case "planner":
    output = {
      prompt: "unused planner output",
      readFiles: ["src/input.ts"],
      writeTargets: ["src/result.ts"],
      notes: []
    };
    break;
  case "generator":
    output = {
      summary: "Generated a result file",
      files: [
        {
          path: "src/result.ts",
          action: "create",
          content: "export const output = 'from-generator';\\n"
        }
      ]
    };
    break;
  case "fixer":
    output = {
      summary: "Fixed the broken result",
      files: [
        {
          path: "src/result.ts",
          action: "update",
          content: "export const output = 'fixed-after-resume';\\n"
        }
      ]
    };
    break;
  case "reviewer":
    output = prompt.includes("fixed-after-resume")
      ? {
          summary: "Looks good",
          issues: []
        }
      : prompt.includes("broken-after-resume")
      ? {
          summary: "Blocking issue found",
          issues: [
            {
              severity: "high",
              category: "correctness",
              path: "src/result.ts",
              description: "The generated output is broken.",
              suggestedFix: "Replace the broken content."
            }
          ]
        }
      : {
          summary: "Looks good",
          issues: []
        };
    break;
  default:
    output = { summary: "Unexpected role", issues: [] };
    break;
}

process.stdout.write(JSON.stringify(output));
`;
}

function providerSummary() {
  return {
    planner: "gemini-cli",
    reviewer: "gemini-cli",
    generator: "gemini-cli",
    fixer: "gemini-cli"
  };
}

function silentLogger(): Logger {
  return {
    step() {},
    info() {},
    warn() {},
    error() {},
    success() {}
  };
}
