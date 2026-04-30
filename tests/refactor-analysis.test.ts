import { test } from "node:test";
import assert from "node:assert/strict";
import { performRefactorAnalysis } from "../ai-system/core/refactor-analysis.js";
import { DependencyGraph } from "../ai-system/core/dependency-graph.js";

test("performRefactorAnalysis builds dependency clusters and batches", async () => {
  const repoRoot = "/tmp";
  const dependencyGraph = new DependencyGraph(repoRoot);
  
  // Mock nodes
  dependencyGraph.nodes.set("src/a.ts", { path: "src/a.ts", imports: ["src/b.ts"], importedBy: [] });
  dependencyGraph.nodes.set("src/b.ts", { path: "src/b.ts", imports: [], importedBy: ["src/a.ts"] });
  dependencyGraph.nodes.set("src/c.ts", { path: "src/c.ts", imports: [], importedBy: [] });

  const result = await performRefactorAnalysis({
    repoRoot,
    goal: "Refactor everything",
    changedFiles: ["src/a.ts", "src/c.ts"],
    dependencyGraph
  });

  assert.strictEqual(result.goal, "Refactor everything");
  assert.ok(result.affectedFiles.includes("src/a.ts"));
  assert.ok(result.affectedFiles.includes("src/b.ts")); // Affected by a.ts
  assert.ok(result.affectedFiles.includes("src/c.ts"));

  // src/a.ts and src/b.ts should be in one cluster, src/c.ts in another
  assert.strictEqual(result.dependencyClusters.length, 2);
  assert.strictEqual(result.proposedBatches.length, 2);
  
  const batch1 = result.proposedBatches.find(b => b.files.includes("src/a.ts"));
  assert.ok(batch1?.files.includes("src/b.ts"));
  assert.strictEqual(batch1?.type, "mechanical"); // small cluster
  assert.match(batch1?.rollback ?? "", /Do not auto-revert/);
  assert.doesNotMatch(batch1?.rollback ?? "", /git checkout/);
});

test("performRefactorAnalysis identifies risk areas", async () => {
  const repoRoot = "/tmp";
  const dependencyGraph = new DependencyGraph(repoRoot);
  
  dependencyGraph.nodes.set("src/types.ts", { path: "src/types.ts", imports: [], importedBy: ["f1", "f2", "f3", "f4", "f5", "f6"] });

  const result = await performRefactorAnalysis({
    repoRoot,
    goal: "Change types",
    changedFiles: ["src/types.ts"],
    dependencyGraph
  });

  assert.ok(result.riskAreas.some(r => r.file === "src/types.ts" && r.reason.includes("Highly coupled")));
  assert.ok(result.riskAreas.some(r => r.file === "src/types.ts" && r.reason.includes("Core type/schema change")));
});
