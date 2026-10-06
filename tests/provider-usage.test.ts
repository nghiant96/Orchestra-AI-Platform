import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { ProviderUsageRecorder, estimateTokens } from "../ai-system/worker/provider-usage.js";
import { persistProviderUsage, summarizeProviderUsage } from "../ai-system/worker/provider-usage-artifact.js";
import { WorkerProcessSupervisor } from "../ai-system/worker/worker-process-supervisor.js";
import { removeTempDir } from "./test-utils.js";

describe("provider usage accounting", () => {
  test("totals every recorded invocation", () => {
    const usage = new ProviderUsageRecorder("job-1");
    usage.record({ label: "phase:1", command: "codex", startedAt: 1000, durationMs: 250, promptBytes: 400, outputBytes: 800, exitOk: true });
    usage.record({ label: "phase:2", command: "codex", startedAt: 2000, durationMs: 750, promptBytes: 200, outputBytes: 0, exitOk: false });

    const report = usage.build();
    assert.equal(report.totals.invocations, 2);
    assert.equal(report.totals.promptBytes, 600);
    assert.equal(report.totals.outputBytes, 800);
    assert.equal(report.totals.durationMs, 1000);
    assert.equal(report.totals.estimatedTotalTokens, estimateTokens(600) + estimateTokens(800));
  });

  test("a failed invocation is still counted, because it still cost", () => {
    const usage = new ProviderUsageRecorder("job-2");
    usage.record({ label: "phase:1", command: "codex", startedAt: 0, durationMs: 10, promptBytes: 100, outputBytes: 0, exitOk: false });

    const report = usage.build();
    assert.equal(report.totals.invocations, 1);
    assert.equal(report.invocations[0]?.exitOk, false);
    assert.ok(report.totals.estimatedPromptTokens > 0);
  });

  test("the report says its token numbers are estimates", () => {
    // Nobody should mistake a bytes/4 approximation for metered billing.
    const usage = new ProviderUsageRecorder("job-3");
    usage.record({ label: "p", command: "codex", startedAt: 0, durationMs: 1, promptBytes: 10, outputBytes: 10, exitOk: true });
    assert.match(usage.build().note, /estimated/i);
  });

  test("the supervisor meters a real spawned process", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-usage-"));
    try {
      const usage = new ProviderUsageRecorder("job-4");
      const supervisor = new WorkerProcessSupervisor(usage);

      await supervisor.run({
        command: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(400))"],
        cwd: tmpDir,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 30_000,
        usageLabel: "phase:1:implementation"
      });

      const report = usage.build();
      assert.equal(report.totals.invocations, 1);
      assert.equal(report.invocations[0]?.label, "phase:1:implementation");
      assert.equal(report.invocations[0]?.outputBytes, 400, "stdout bytes are measured, not guessed");
      assert.ok(report.invocations[0]!.promptBytes > 0, "argv bytes count as the prompt");
      assert.equal(report.invocations[0]?.exitOk, true);
    } finally {
      await removeTempDir(tmpDir);
    }
  });

  test("a process that fails is metered and the error still propagates", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-usage-fail-"));
    try {
      const usage = new ProviderUsageRecorder("job-5");
      const supervisor = new WorkerProcessSupervisor(usage);

      await assert.rejects(() =>
        supervisor.run({
          command: process.execPath,
          args: ["-e", "process.exit(3)"],
          cwd: tmpDir,
          env: { PATH: process.env.PATH ?? "" },
          timeoutMs: 30_000,
          usageLabel: "phase:1:implementation"
        })
      );

      assert.equal(usage.count, 1, "a failed spawn must still be accounted for");
      assert.equal(usage.build().invocations[0]?.exitOk, false);
    } finally {
      await removeTempDir(tmpDir);
    }
  });

  test("unlabelled calls are not metered, so the availability probe stays out", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-usage-probe-"));
    try {
      const usage = new ProviderUsageRecorder("job-6");
      const supervisor = new WorkerProcessSupervisor(usage);
      await supervisor.run({
        command: process.execPath,
        args: ["-e", "process.stdout.write('v1')"],
        cwd: tmpDir,
        env: { PATH: process.env.PATH ?? "" },
        timeoutMs: 30_000
      });
      assert.equal(usage.count, 0);
    } finally {
      await removeTempDir(tmpDir);
    }
  });

  test("the report is written beside the job's other artifacts", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-usage-artifact-"));
    try {
      const usage = new ProviderUsageRecorder("job-7");
      usage.record({ label: "phase:1", command: "codex", startedAt: 0, durationMs: 5, promptBytes: 40, outputBytes: 80, exitOk: true });

      const report = await persistProviderUsage(artifactDir, usage);
      assert.ok(report);

      const written = JSON.parse(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.providerUsage), "utf8"));
      assert.equal(written.jobId, "job-7");
      assert.equal(written.totals.invocations, 1);
      assert.match(summarizeProviderUsage(report), /1 invocation\(s\)/);
    } finally {
      await removeTempDir(artifactDir);
    }
  });

  test("nothing is written when nothing was metered", async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-usage-empty-"));
    try {
      assert.equal(await persistProviderUsage(artifactDir, new ProviderUsageRecorder("job-8")), null);
      await assert.rejects(() => fs.stat(path.join(artifactDir, ARTIFACT_PATHS.providerUsage)));
    } finally {
      await removeTempDir(artifactDir);
    }
  });
});
