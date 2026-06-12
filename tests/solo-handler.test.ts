import assert from "node:assert/strict";
import test from "node:test";
import { handleSoloCommand } from "../ai-system/cli/handlers/solo-handler.js";

test("solo handler delegates CLI input to SoloRunner", async () => {
  let received: any = null;
  const handled = await handleSoloCommand(
    { kind: "solo-run", executionMode: "safe" },
    {
      cwd: "/tmp/project",
      task: "Refactor payment session flow",
      outputJson: true,
      savePath: null,
      allowDirtyWorkingTree: true
    },
    {
      async run(input) {
        received = input;
        return {
          ok: true,
          jobId: "job-handler",
          artifactRoot: "/tmp/project/.orchestra/jobs/job-handler",
          summary: "done",
          changedFiles: [],
          guardStatus: "passed",
          verificationStatus: "passed"
        };
      },
      writeOutput() {}
    }
  );

  assert.equal(handled, true);
  assert.deepEqual(received, {
    task: "Refactor payment session flow",
    executionMode: "safe",
    repoRoot: "/tmp/project",
    artifactRootDir: undefined,
    allowDirtyWorkingTree: true,
    providerId: "codex",
    providerCommand: undefined
  });
});

test("solo handler ignores unrelated commands", async () => {
  const handled = await handleSoloCommand(
    { kind: "doctor" },
    { cwd: "/tmp/project", task: "", outputJson: false, savePath: null, allowDirtyWorkingTree: false }
  );
  assert.equal(handled, false);
});
