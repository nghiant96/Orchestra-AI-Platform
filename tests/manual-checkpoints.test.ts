import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEditableContextCheckpoint, loadEditablePlanCheckpoint } from "../ai-system/core/manual-checkpoints.js";
import type { PlanResult, RulesConfig } from "../ai-system/types.js";

test("loadEditablePlanCheckpoint reads user-edited plan.json safely", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-manual-plan-"));
  const artifactPath = path.join(tempDir, ".ai-system-artifacts/run-1/01-plan");
  const repoFile = path.join(tempDir, "src/edited.ts");
  const fallbackPlan: PlanResult = {
    prompt: "old prompt",
    readFiles: ["src/original.ts"],
    writeTargets: ["src/original.ts"],
    notes: []
  };

  try {
    await fs.mkdir(path.dirname(repoFile), { recursive: true });
    await fs.mkdir(artifactPath, { recursive: true });
    await fs.writeFile(repoFile, "export const edited = true;\n", "utf8");
    await fs.writeFile(
      path.join(artifactPath, "plan.json"),
      JSON.stringify(
        {
          normalizedPlan: {
            prompt: "edited prompt",
            readFiles: ["src/edited.ts", "../secret.ts"],
            writeTargets: ["src/edited.ts", "/tmp/outside.ts"],
            notes: ["edited manually"]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const plan = await loadEditablePlanCheckpoint(artifactPath, fallbackPlan, tempDir, createRules());

    assert.equal(plan.prompt, "edited prompt");
    assert.deepEqual(plan.readFiles, ["src/edited.ts"]);
    assert.deepEqual(plan.writeTargets, ["src/edited.ts"]);
    assert.deepEqual(plan.notes, ["edited manually"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadEditableContextCheckpoint reloads edited context files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-manual-context-"));
  const artifactPath = path.join(tempDir, ".ai-system-artifacts/run-1/02-context");

  try {
    await fs.mkdir(path.join(artifactPath, "files/src"), { recursive: true });
    await fs.writeFile(
      path.join(artifactPath, "context.json"),
      JSON.stringify({ savedFiles: ["src/context.ts", "../unsafe.ts"] }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(artifactPath, "files/src/context.ts"), "export const edited = true;\n", "utf8");

    const contexts = await loadEditableContextCheckpoint(artifactPath, [
      { path: "src/context.ts", content: "old content\n" }
    ]);

    assert.deepEqual(contexts, [{ path: "src/context.ts", content: "export const edited = true;\n" }]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function createRules(): RulesConfig {
  return {
    max_iterations: 3,
    max_files: 5,
    max_write_files: 8,
    max_context_bytes: 60000,
    request_timeout_ms: 60000,
    request_retries: 1,
    retry_base_delay_ms: 250,
    memory: { enabled: false, backend: "local-file" },
    providers: {
      planner: { type: "codex-cli" },
      reviewer: { type: "codex-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    },
    excluded_directories: [".git", "node_modules"],
    sensitive_file_names: [".env"]
  };
}
