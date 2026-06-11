import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ARTIFACT_PATHS, checkJsonPath, checkLogPath } from "../ai-system/artifacts/artifact-paths.js";
import { runWorkerVerification } from "../ai-system/worker/verification-runner.js";

test("worker verification artifacts include failed command detail", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "verification-artifacts-"));
  const repoRoot = tmpDir;
  const worktreePath = tmpDir;
  const artifactDir = path.join(tmpDir, "artifact");

  try {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "index.js"), "console.log('hello')\n", "utf8");
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "verification-artifacts-test",
        private: true,
        type: "module",
      }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tmpDir, ".ai-system.json"),
      JSON.stringify({
        tools: {
          enabled: true,
          commands: {
            lint: {
              enabled: true,
              command: "node",
              args: ["-e", "process.exit(2)"]
            },
            typecheck: { enabled: false },
            build: { enabled: false },
            test: { enabled: false }
          }
        }
      }, null, 2),
      "utf8"
    );

    const result = await runWorkerVerification({
      repoRoot,
      worktreePath,
      artifactDir,
      changedFiles: ["src/index.js"],
      logger: silentLogger()
    });

    assert.equal(result.ok, false);

    const verificationJson = JSON.parse(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.verification), "utf8"));
    assert.equal(verificationJson.status, "failed");
    assert.ok(Array.isArray(verificationJson.failedChecks));
    assert.ok(verificationJson.failedChecks.length > 0);
    assert.match(JSON.stringify(verificationJson.failedChecks[0]), /"exitCode":2/);
    assert.ok(Array.isArray(verificationJson.passedChecks));
    assert.ok(Array.isArray(verificationJson.skippedChecks));

    const lintCheckJsonPath = path.join(artifactDir, checkJsonPath("lint"));
    const checkJson = JSON.parse(await fs.readFile(lintCheckJsonPath, "utf8"));
    assert.equal(checkJson.ok, false);
    assert.equal(checkJson.exitCode, 2);
    assert.equal(checkJson.status, undefined);

    const checkLog = await fs.readFile(path.join(artifactDir, checkLogPath("lint")), "utf8");
    assert.match(checkLog, /status: failed/);
    assert.match(checkLog, /exitCode: 2/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    step() {},
    success() {}
  };
}
