import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prepareFixFromRun } from "../ai-system/core/fix-from-run.js";
import { createLogger } from "../ai-system/utils/logger.js";

async function createTempRepo() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-fix-from-run-"));
}

test("prepareFixFromRun returns resumable recovery when retry hint exists", async () => {
  const repoRoot = await createTempRepo();
  const runDir = path.join(repoRoot, ".ai-system-artifacts", "run-1");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "run-state.json"),
    JSON.stringify({
      status: "failed",
      task: "Fix auth flow",
      plan: { prompt: "Fix auth flow", readFiles: ["src/auth.ts"], writeTargets: ["src/auth.ts"], notes: [] },
      issueCounts: { high: 1, medium: 0, low: 0 },
      providers: { planner: "codex-cli", reviewer: "codex-cli", generator: "codex-cli", fixer: "codex-cli" },
      execution: {
        totalDurationMs: 1000,
        steps: [],
        transitions: [],
        currentStage: "iteration-tools",
        terminalStage: "failed",
        failure: { class: "tool-check-failed", reason: "tool checks failed" },
        retryHint: { stage: "iteration-tools", reason: "retry tool checks" }
      }
    }),
    "utf8"
  );

  try {
    const preparation = await prepareFixFromRun({
      repoRoot,
      configPath: null,
      target: "last",
      logger: createLogger({ verbose: false })
    });

    assert.equal(preparation.resumable, true);
    assert.ok(preparation.resumeTarget?.endsWith("run-state.json"));
    assert.match(preparation.task, /Fix auth flow/);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("prepareFixFromRun builds follow-up task for non-resumable run", async () => {
  const repoRoot = await createTempRepo();
  const runDir = path.join(repoRoot, ".ai-system-artifacts", "run-1");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "run-state.json"),
    JSON.stringify({
      status: "completed",
      task: "Refactor auth flow",
      plan: { prompt: "Refactor auth flow", readFiles: ["src/auth.ts"], writeTargets: ["src/auth.ts"], notes: [] },
      issueCounts: { high: 0, medium: 2, low: 0 },
      latestReviewSummary: "Review found remaining auth issues.",
      latestToolResults: [
        {
          name: "lint",
          kind: "command",
          ok: false,
          skipped: false,
          issueCount: 1,
          durationMs: 12,
          summary: "lint failed."
        }
      ],
      result: { summary: "updated files", files: [{ path: "src/auth.ts", content: "export const value = 1;\n" }] },
      providers: { planner: "codex-cli", reviewer: "codex-cli", generator: "codex-cli", fixer: "codex-cli" },
      execution: {
        totalDurationMs: 1000,
        steps: [],
        transitions: [],
        currentStage: "success",
        terminalStage: "success",
        failure: null
      }
    }),
    "utf8"
  );

  try {
    const preparation = await prepareFixFromRun({
      repoRoot,
      configPath: null,
      target: "last",
      logger: createLogger({ verbose: false })
    });

    assert.equal(preparation.resumable, false);
    assert.equal(preparation.resumeTarget, null);
    assert.match(preparation.task, /Continue fixing a previous run/);
    assert.match(preparation.task, /Latest failing checks/);
    assert.deepEqual(preparation.fileHints, ["src/auth.ts"]);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
