import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlastRadiusContext } from "../ai-system/core/blast-radius.js";

test("buildBlastRadiusContext identifies related tests by convention", async () => {
  const result = await buildBlastRadiusContext({
    repoRoot: "/tmp",
    changedFiles: ["src/auth.ts", "ai-system/core/orchestrator.ts"]
  });

  assert.ok(result.relatedTests.includes("src/auth.test.ts"));
  assert.ok(result.relatedTests.includes("ai-system/core/orchestrator.test.ts"));
});

test("buildBlastRadiusContext generates risk signals for large changes", async () => {
  const changedFiles = Array.from({ length: 11 }, (_, i) => `file${i}.ts`);
  const result = await buildBlastRadiusContext({
    repoRoot: "/tmp",
    changedFiles
  });

  const signal = result.riskSignals.find(s => s.name === "large-change-set");
  assert.ok(signal);
  assert.strictEqual(signal.severity, "medium");
});

test("buildBlastRadiusContext generates risk signals for sensitive files", async () => {
  const result = await buildBlastRadiusContext({
    repoRoot: "/tmp",
    changedFiles: [".env", "ai-system/core/risk-policy.ts"]
  });

  const signal = result.riskSignals.find(s => s.name === "sensitive-files-changed");
  assert.ok(signal);
  assert.strictEqual(signal.severity, "high");
});

test("buildBlastRadiusContext generates risk signals for failures", async () => {
  const result = await buildBlastRadiusContext({
    repoRoot: "/tmp",
    changedFiles: ["src/main.ts"],
    contracts: [{ id: "c1", description: "c1", severity: "high", status: "failed", checkStrategy: "deterministic", targetPaths: [] }],
    toolResults: [{ name: "lint", kind: "command", ok: false, skipped: false, issueCount: 1, durationMs: 10, summary: "failed" }]
  });

  assert.ok(result.riskSignals.find(s => s.name === "contract-failures"));
  assert.ok(result.riskSignals.find(s => s.name === "tool-failures"));
});
