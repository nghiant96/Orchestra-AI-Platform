import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildImplementationPromptWithContext } from "../ai-system/worker/contextual-phase-prompt.js";
import { extractContextPackFromProviderResult } from "../ai-system/worker/context-pack-parser.js";
import { renderWorkerContextPackMarkdown, saveWorkerContextPack, loadWorkerContextPack } from "../ai-system/worker/context-pack.js";
import { buildWorkerTaskPhasePlan } from "../ai-system/worker/task-phases.js";

test("setup phase prompt requires an ORCHESTRA_CONTEXT_PACK block", () => {
  const plan = buildWorkerTaskPhasePlan(
    [
      "- Refactor the payment API integration so the worker must inspect the service boundary before editing.",
      "- Update the payment screen to consume the refactored API while preserving existing behavior.",
      "- Add focused tests and verify the result with targeted checks before finishing."
    ].join("\n")
  );
  const setupPhase = plan.phases.find((phase) => phase.kind === "setup");

  assert.ok(setupPhase);
  assert.match(setupPhase.prompt, /ORCHESTRA_CONTEXT_PACK/);
  assert.match(setupPhase.prompt, /allowedDiffBoundary/);
});

test("extractContextPackFromProviderResult parses provider output JSON", () => {
  const pack = extractContextPackFromProviderResult(`
work complete
ORCHESTRA_CONTEXT_PACK:
{
  "summary": "Payment flow context",
  "relevantFiles": [
    { "path": "src/payment/api.ts", "reason": "API client", "status": "existing", "role": "api-client" }
  ],
  "allowedDiffBoundary": ["src/payment/**"],
  "doNotTouch": ["src/auth/**"],
  "conventions": { "apiClientPatterns": ["*Api.ts"] },
  "implementationPlan": ["Update client"],
  "verificationCommands": ["pnpm test payment"],
  "assumptions": [],
  "missingContextWarnings": [],
  "confidence": "high"
}
`, { jobId: "job-1", task: "payment task" });

  assert.ok(pack);
  assert.equal(pack.jobId, "job-1");
  assert.equal(pack.task, "payment task");
  assert.equal(pack.confidence, "high");
  assert.deepEqual(pack.allowedDiffBoundary, ["src/payment/**"]);
  assert.equal(pack.relevantFiles[0]?.role, "api-client");
});

test("implementation prompt includes rendered context pack guidance", () => {
  const prompt = buildImplementationPromptWithContext({
    phasePrompt: "Implement this slice.",
    contextPack: {
      version: 1,
      jobId: "job-2",
      task: "task",
      generatedAt: "2026-06-06T00:00:00.000Z",
      summary: "Use payment files.",
      relevantFiles: [{ path: "src/payment/api.ts", reason: "API client", status: "existing", role: "api-client" }],
      allowedDiffBoundary: ["src/payment/**"],
      doNotTouch: ["src/auth/**"],
      conventions: {},
      implementationPlan: ["Update API"],
      verificationCommands: ["pnpm test payment"],
      assumptions: [],
      missingContextWarnings: [],
      confidence: "medium"
    }
  });

  assert.match(prompt, /Context Pack rules/);
  assert.match(prompt, /src\/payment\/api\.ts/);
  assert.match(prompt, /src\/auth\/\*\*/);
});

test("context pack persistence writes JSON and markdown artifacts", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-pack-"));
  try {
    const pack = {
      version: 1 as const,
      jobId: "job-3",
      task: "task",
      generatedAt: "2026-06-06T00:00:00.000Z",
      summary: "Summary",
      relevantFiles: [],
      allowedDiffBoundary: [],
      doNotTouch: [],
      conventions: {},
      implementationPlan: [],
      verificationCommands: [],
      assumptions: [],
      missingContextWarnings: [],
      confidence: "low" as const
    };

    await saveWorkerContextPack(tmpDir, pack);
    const loaded = await loadWorkerContextPack(tmpDir);
    const markdown = await fs.readFile(path.join(tmpDir, "context-pack.md"), "utf8");

    assert.equal(loaded?.jobId, "job-3");
    assert.equal(renderWorkerContextPackMarkdown(pack), markdown);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
