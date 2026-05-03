import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { 
  rankContextCandidates,
  trimRankedCandidatesByBudget 
} from "../ai-system/core/context-intelligence.js";
import type { ContextSelectionCandidate } from "../ai-system/types.js";

describe("Context Intelligence Core", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("rankContextCandidates assigns correct scores to files", () => {
    const candidates = rankContextCandidates({
      initialReadFiles: ["initial.ts"],
      dependencyFiles: ["dep1.ts", "target.ts"], // Target is also a dependency
      writeTargetReads: ["target.ts"],
      changedHintFiles: ["changed.ts"],
      vectorMatches: [{ id: "1", path: "semantic.ts", score: 0.8, startLine: 1, endLine: 10, preview: "" }]
    });

    // Expect: initial (100), target (95), changed (85), dep1 (70), semantic (48)
    const getScore = (path: string) => candidates.find((c: ContextSelectionCandidate) => c.path === path)?.score;
    assert.equal(getScore("initial.ts"), 100);
    assert.equal(getScore("target.ts"), 95); // max(95, 70)
    assert.equal(getScore("changed.ts"), 85);
    assert.equal(getScore("dep1.ts"), 70);
    assert.equal(getScore("semantic.ts"), 48);
  });

  it("trimRankedCandidatesByBudget removes files when budget is exceeded", async () => {
    mock.method(fs, "stat", async () => ({ size: 100 })); // Each file is 100 bytes

    const rankedCandidates: ContextSelectionCandidate[] = [
      { path: "initial.ts", score: 100, sources: ["planner"] },
      { path: "target.ts", score: 95, sources: ["write-target"] },
      { path: "dep1.ts", score: 70, sources: ["dependency"] }
    ];

    const result = await trimRankedCandidatesByBudget({
      repoRoot: "/mock",
      rankedCandidates,
      maxExpandedFiles: 5,
      maxContextBytes: 200 // Only fits 2 files
    });

    assert.equal(result.selectedPaths.length, 2);
    assert.ok(result.selectedPaths.includes("initial.ts"));
    assert.ok(result.selectedPaths.includes("target.ts"));
    
    assert.equal(result.trimmedPaths.length, 1);
    assert.ok(result.trimmedPaths.includes("dep1.ts")); // Removed due to budget limit
    assert.equal(result.selectedBytes, 200);
    assert.equal(result.trimmedSummaries[0]?.path, "dep1.ts");
    assert.match(result.trimmedSummaries[0]?.reason ?? "", /context budget/);
  });
  
  it("trimRankedCandidatesByBudget removes files when file count limit is exceeded", async () => {
    mock.method(fs, "stat", async () => ({ size: 10 })); // Small files

    const rankedCandidates: ContextSelectionCandidate[] = [
      { path: "initial.ts", score: 100, sources: ["planner"] },
      { path: "target.ts", score: 95, sources: ["write-target"] },
      { path: "dep1.ts", score: 70, sources: ["dependency"] }
    ];

    const result = await trimRankedCandidatesByBudget({
      repoRoot: "/mock",
      rankedCandidates,
      maxExpandedFiles: 2, // Only fits 2 files
      maxContextBytes: 1000 // Huge budget
    });

    assert.equal(result.selectedPaths.length, 2);
    assert.ok(result.selectedPaths.includes("initial.ts"));
    assert.ok(result.selectedPaths.includes("target.ts"));
    
    assert.equal(result.trimmedPaths.length, 1);
    assert.ok(result.trimmedPaths.includes("dep1.ts"));
    assert.equal(result.selectedBytes, 20);
    assert.equal(result.trimmedSummaries[0]?.path, "dep1.ts");
    assert.match(result.trimmedSummaries[0]?.reason ?? "", /max file count/);
  });

  it("rankContextCandidates and budget trimming expose inclusion and exclusion reasons", async () => {
    mock.method(fs, "stat", async () => ({ size: 100 }));

    const rankedCandidates = rankContextCandidates({
      initialReadFiles: ["initial.ts"],
      dependencyFiles: ["dep1.ts"],
      writeTargetReads: ["target.ts"],
      changedHintFiles: [],
      vectorMatches: []
    });

    const result = await trimRankedCandidatesByBudget({
      repoRoot: "/mock",
      rankedCandidates,
      maxExpandedFiles: 2,
      maxContextBytes: 150
    });

    const selected = rankedCandidates.find((entry) => entry.path === "target.ts");
    const trimmed = result.trimmedSummaries.find((entry) => entry.path === "dep1.ts");
    assert.equal(selected?.inclusionReason, "target of a planned write operation");
    assert.equal(trimmed?.reason.includes("context budget") || trimmed?.reason.includes("max file count"), true);
  });
});
