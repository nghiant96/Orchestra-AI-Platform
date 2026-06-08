import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCommand } from "../ai-system/utils/api.js";
import { runNamingGuard, writeNamingGuardArtifact } from "../ai-system/worker/naming-guard.js";
import { scanRepoConventions, writeRepoConventionScanArtifact } from "../ai-system/worker/repo-convention-scanner.js";

test("naming guard warns for scenario-like generated names", async () => {
  const result = await withEnv({}, async () => runNamingGuard({
    changedFiles: ["src/screens/S2HomeScreen.tsx", "src/api/OAuth2Client.ts"]
  }));

  assert.equal(result.ok, true);
  assert.equal(result.findings.some((finding) => finding.filePath === "src/screens/S2HomeScreen.tsx"), true);
  assert.equal(result.findings.some((finding) => finding.filePath === "src/api/OAuth2Client.ts"), false);
});

test("naming guard strict mode fails suspicious names and writes artifact", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "naming-guard-"));
  try {
    const result = await withEnv({ ORCHESTRA_NAMING_GUARD_MODE: "strict" }, async () => runNamingGuard({
      changedFiles: ["src/SearchSA2match.ts"]
    }));
    await writeNamingGuardArtifact(tmpDir, result);

    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.severity, "error");
    const artifact = JSON.parse(await fs.readFile(path.join(tmpDir, "naming-check.json"), "utf8"));
    assert.equal(artifact.ok, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("repo convention scanner records common filename patterns", async () => {
  const repoRoot = await createGitRepo("repo-conventions-");
  const artifactDir = path.join(repoRoot, "artifact");
  try {
    await fs.mkdir(path.join(repoRoot, "src/hooks"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "src/services"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "src/hooks/usePayment.ts"), "export const usePayment = () => null;\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src/services/PaymentService.ts"), "export const PaymentService = {};\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src/PaymentService.test.ts"), "export {};\n", "utf8");
    await runCommand({ command: "git", args: ["add", "."], cwd: repoRoot });
    await runCommand({ command: "git", args: ["commit", "-m", "add conventions"], cwd: repoRoot });

    const result = await scanRepoConventions(repoRoot);
    await writeRepoConventionScanArtifact(artifactDir, result);

    assert.equal(result.hookPatterns.some((pattern) => pattern.pattern === "use*.ts"), true);
    assert.equal(result.servicePatterns.some((pattern) => pattern.pattern === "*Service.ts"), true);
    assert.equal(result.testPatterns.some((pattern) => pattern.pattern === "*.test.ts"), true);
    assert.ok(await exists(path.join(artifactDir, "repo-conventions.json")));
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# test\n", "utf8");
  await runCommand({ command: "git", args: ["add", "README.md"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}

async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.ORCHESTRA_NAMING_GUARD_MODE;
  delete process.env.ORCHESTRA_NAMING_GUARD_MODE;
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRA_NAMING_GUARD_MODE;
    } else {
      process.env.ORCHESTRA_NAMING_GUARD_MODE = previous;
    }
  }
}

async function exists(value: string): Promise<boolean> {
  try {
    await fs.stat(value);
    return true;
  } catch {
    return false;
  }
}
