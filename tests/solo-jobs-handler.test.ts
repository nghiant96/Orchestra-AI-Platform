import assert from "node:assert/strict";
import test from "node:test";
import { handleSoloJobsCommand } from "../ai-system/cli/handlers/solo-jobs-handler.js";

test("solo jobs handler delegates job list", async () => {
  let called = false;
  const handled = await handleSoloJobsCommand(
    { kind: "solo-job-list" },
    { cwd: "/tmp/project", outputJson: false, savePath: null },
    {
      async list(input) {
        called = true;
        assert.equal(input.repoRoot, "/tmp/project");
        return [];
      }
    }
  );

  assert.equal(handled, true);
  assert.equal(called, true);
});

test("solo jobs handler delegates continue with target and verification mode", async () => {
  let called = false;
  const handled = await handleSoloJobsCommand(
    { kind: "solo-continue", target: "job-123", fixVerification: true },
    { cwd: "/tmp/project", outputJson: true, savePath: null },
    {
      async continue(input) {
        called = true;
        assert.equal(input.repoRoot, "/tmp/project");
        assert.equal(input.target, "job-123");
        assert.equal(input.fixVerification, true);
        assert.equal(input.providerId.length > 0, true);
        return {
          sourceJobId: "job-123",
          prompt: "continue prompt",
          run: {
            ok: true,
            jobId: "job-456",
            artifactRoot: "/tmp/project/.orchestra/jobs/job-456",
            summary: "continued",
            changedFiles: [],
            guardStatus: "passed",
            verificationStatus: "passed"
          }
        };
      }
    }
  );

  assert.equal(handled, true);
  assert.equal(called, true);
});

test("solo jobs handler delegates commit", async () => {
  let called = false;
  const handled = await handleSoloJobsCommand(
    { kind: "solo-commit", target: "last" },
    { cwd: "/tmp/project", outputJson: true, savePath: null },
    {
      async commit(input) {
        called = true;
        assert.equal(input.repoRoot, "/tmp/project");
        assert.equal(input.target, "last");
        return {
          ok: true,
          jobId: "job-123",
          artifactRoot: "/tmp/project/.orchestra/jobs/job-123",
          changedFiles: ["src/output.ts"],
          message: "Apply solo job",
          commitSha: "abc123",
          summary: "committed"
        };
      }
    }
  );

  assert.equal(handled, true);
  assert.equal(called, true);
});

test("solo jobs handler ignores unrelated commands", async () => {
  const handled = await handleSoloJobsCommand(
    { kind: "doctor" },
    { cwd: "/tmp/project", outputJson: false, savePath: null }
  );
  assert.equal(handled, false);
});
