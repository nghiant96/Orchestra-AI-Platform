import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactState, persistIterationArtifacts, persistPlanArtifacts } from "../ai-system/core/artifacts.js";
import { applyArtifactCandidate, loadArtifactCandidate } from "../ai-system/core/artifact-apply.js";
import type { RulesConfig, PlanResult } from "../ai-system/types.js";

test("loadArtifactCandidate and applyArtifactCandidate load and apply the latest iteration artifact", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-artifact-apply-"));
  const rules = createRules();
  const plan: PlanResult = {
    prompt: "Apply artifact candidate",
    readFiles: ["src/example.ts"],
    writeTargets: ["src/example.ts"],
    notes: []
  };

  try {
    await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "src/example.ts"), "export const value = 'before';\n", "utf8");

    const state = createArtifactState(repoRoot, rules);
    await persistPlanArtifacts(state, {
      task: "Apply artifact candidate",
      rawPlan: { prompt: plan.prompt },
      plan,
      provider: "codex-cli"
    });
    await persistIterationArtifacts(state, {
      iteration: 1,
      task: "Apply artifact candidate",
      dryRun: false,
      plan,
      provider: "codex-cli",
      resultSummary: "Updated the example value",
      candidateFiles: [{ path: "src/example.ts", action: "update", content: "export const value = 'after';\n" }],
      originalFiles: [{ path: "src/example.ts", content: "export const value = 'before';\n" }],
      diffSummaries: [],
      toolResults: [],
      preReviewIssues: [],
      reviewSummary: "Looks good.",
      issues: []
    });

    const artifactTarget = state.latestIterationPath as string;
    const artifact = await loadArtifactCandidate(repoRoot, rules, artifactTarget);
    assert.equal(artifact.candidateFiles[0]?.content, "export const value = 'after';\n");

    const result = await applyArtifactCandidate({
      repoRoot,
      configPath: null,
      target: artifactTarget,
      dryRun: false,
      force: false
    });

    assert.equal(result.wroteFiles, true);
    assert.deepEqual(result.appliedFiles, ["src/example.ts"]);
    assert.equal(await fs.readFile(path.join(repoRoot, "src/example.ts"), "utf8"), "export const value = 'after';\n");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
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
      planner: { type: "codex-cli" },
      reviewer: { type: "codex-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    }
  };
}
