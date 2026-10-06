import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REVIEW_LENSES,
  resolveReviewPanelConfig,
  runReviewPanel,
  type ReviewLens
} from "../ai-system/core/review-panel.js";
import type { ReviewIssue, ReviewResult } from "../ai-system/types.js";

function issue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    severity: "high",
    category: "correctness",
    path: "src/app.ts",
    line: 10,
    description: "Null dereference",
    suggestedFix: "Guard the value",
    ...overrides
  };
}

function review(issues: ReviewIssue[], summary = "reviewed"): ReviewResult {
  return { summary, issues };
}

const lenses = (...ids: string[]): ReviewLens[] =>
  ids.map((id) => ({ id, instruction: `look at ${id}` }));

describe("resolveReviewPanelConfig", () => {
  test("is off unless explicitly enabled", () => {
    assert.equal(resolveReviewPanelConfig(undefined).enabled, false);
    assert.equal(resolveReviewPanelConfig({}).enabled, false);
    assert.equal(resolveReviewPanelConfig({ quorum: 3 }).enabled, false);
    assert.equal(resolveReviewPanelConfig({ enabled: true }).enabled, true);
  });

  test("defaults to the full lens set and a quorum of two", () => {
    const config = resolveReviewPanelConfig({ enabled: true });
    assert.equal(config.lenses.length, DEFAULT_REVIEW_LENSES.length);
    assert.equal(config.quorum, 2);
  });

  test("selects only the named lenses", () => {
    const config = resolveReviewPanelConfig({ enabled: true, lenses: ["security", "tests"] });
    assert.deepEqual(config.lenses.map((lens) => lens.id), ["security", "tests"]);
  });

  test("clamps a quorum that the panel could never reach", () => {
    // A quorum above the panel size would downgrade every finding to advisory,
    // silently turning the panel off rather than making it stricter.
    const config = resolveReviewPanelConfig({ enabled: true, lenses: ["security"], quorum: 4 });
    assert.equal(config.quorum, 1);
  });

  test("ignores an unusable quorum instead of trusting it", () => {
    assert.equal(resolveReviewPanelConfig({ enabled: true, quorum: 0 }).quorum, 2);
    assert.equal(resolveReviewPanelConfig({ enabled: true, quorum: -1 }).quorum, 2);
    assert.equal(resolveReviewPanelConfig({ enabled: true, quorum: "many" }).quorum, 2);
  });

  test("cannot be enabled with no lenses to run", () => {
    assert.equal(resolveReviewPanelConfig({ enabled: true, lenses: ["nonsense"] }).enabled, false);
  });
});

describe("runReviewPanel", () => {
  test("runs every lens concurrently, not one after another", async () => {
    const holdMs = 150;
    const startedAt = Date.now();
    await runReviewPanel(lenses("a", "b", "c"), 2, async () => {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      return review([]);
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(
      elapsed < holdMs * 3,
      `panel took ${elapsed}ms; anything near ${holdMs * 3}ms means the lenses ran in sequence`
    );
  });

  test("a finding that meets quorum keeps the harshest severity reported", async () => {
    const outcome = await runReviewPanel(lenses("correctness", "security"), 2, async (lens) =>
      review([issue({ category: "shared", severity: lens.id === "security" ? "high" : "medium" })])
    );

    assert.equal(outcome.result.issues.length, 1);
    const merged = outcome.result.issues[0]!;
    assert.equal(merged.severity, "high");
    assert.equal(merged.agreement?.count, 2);
    assert.equal(merged.agreement?.quorumMet, true);
    assert.deepEqual(merged.agreement?.lenses, ["correctness", "security"]);
  });

  test("a lone finding is kept but downgraded so it cannot block on its own", async () => {
    const outcome = await runReviewPanel(lenses("a", "b", "c"), 2, async (lens) =>
      lens.id === "a" ? review([issue({ severity: "high" })]) : review([])
    );

    assert.equal(outcome.result.issues.length, 1, "a minority finding must not be discarded");
    const only = outcome.result.issues[0]!;
    assert.equal(only.severity, "low", "below quorum it becomes advisory");
    assert.equal(only.agreement?.quorumMet, false);
    assert.match(only.description, /advisory/);
  });

  test("distinct defects are not merged just because they share a file", async () => {
    const outcome = await runReviewPanel(lenses("a", "b"), 2, async (lens) =>
      lens.id === "a"
        ? review([issue({ line: 10, category: "correctness" })])
        : review([issue({ line: 400, category: "security" })])
    );

    assert.equal(outcome.result.issues.length, 2);
    for (const found of outcome.result.issues) {
      assert.equal(found.agreement?.count, 1);
    }
  });

  test("nearby lines are treated as one defect", async () => {
    const outcome = await runReviewPanel(lenses("a", "b"), 2, async (lens) =>
      review([issue({ category: "shared", line: lens.id === "a" ? 10 : 12 })])
    );
    assert.equal(outcome.result.issues.length, 1);
    assert.equal(outcome.result.issues[0]?.agreement?.count, 2);
  });

  test("blocking findings are ordered ahead of advisory ones", async () => {
    const outcome = await runReviewPanel(lenses("a", "b"), 2, async (lens) => {
      const agreed = issue({ category: "shared", line: 10, severity: "medium" });
      return lens.id === "a"
        ? review([agreed, issue({ category: "solo", line: 99, severity: "high" })])
        : review([agreed]);
    });

    assert.equal(outcome.result.issues.length, 2);
    assert.equal(outcome.result.issues[0]?.severity, "medium", "the quorum finding leads");
    assert.equal(outcome.result.issues[1]?.severity, "low", "the lone high is demoted behind it");
  });

  test("one failing lens does not sink the panel", async () => {
    const outcome = await runReviewPanel(lenses("a", "b", "c"), 2, async (lens) => {
      if (lens.id === "b") throw new Error("provider exploded");
      return review([issue({ category: "shared" })]);
    });

    assert.equal(outcome.result.issues[0]?.severity, "high");
    const failed = outcome.panelists.find((panelist) => panelist.lensId === "b");
    assert.equal(failed?.ok, false);
    assert.match(failed?.error ?? "", /provider exploded/);
    assert.equal(outcome.panelists.filter((panelist) => panelist.ok).length, 2);
  });

  test("quorum shrinks to the lenses that actually answered", async () => {
    // Two of three lenses die. A quorum of 3 against one survivor would demote
    // every finding, so the panel must not hold survivors to an impossible bar.
    const outcome = await runReviewPanel(lenses("a", "b", "c"), 3, async (lens) => {
      if (lens.id !== "a") throw new Error("down");
      return review([issue({ severity: "high" })]);
    });

    assert.equal(outcome.quorum, 1);
    assert.equal(outcome.result.issues[0]?.severity, "high");
  });

  test("a total panel failure is an error, not a clean review", async () => {
    await assert.rejects(
      () => runReviewPanel(lenses("a", "b"), 1, async () => { throw new Error("all down"); }),
      /Every review lens failed/
    );
  });

  test("an empty panel is rejected outright", async () => {
    await assert.rejects(() => runReviewPanel([], 1, async () => review([])), /at least one lens/);
  });

  test("the summary records who sat on the panel and what carried", async () => {
    const outcome = await runReviewPanel(lenses("correctness", "security"), 2, async (lens) =>
      review([issue({ category: "shared" })], `${lens.id} says hello`)
    );

    assert.match(outcome.result.summary, /panel of 2 lens/i);
    assert.match(outcome.result.summary, /quorum 2/);
    assert.match(outcome.result.summary, /correctness says hello/);
    assert.match(outcome.result.summary, /security says hello/);
  });

  test("missing test requirements from every lens are carried through", async () => {
    const outcome = await runReviewPanel(lenses("tests", "correctness"), 2, async (lens) => ({
      summary: lens.id,
      issues: [],
      missingTests: [
        { name: `${lens.id}-case`, description: "needs a test", severity: "required" as const, status: "not_run" as const }
      ]
    }));

    assert.equal(outcome.result.missingTests?.length, 2);
  });
});
