import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { runCommand } from "../ai-system/utils/api.js";
import { runNamingGuard, writeNamingGuardArtifact } from "../ai-system/worker/naming-guard.js";
import { scanRepoConventions, writeRepoConventionScanArtifact } from "../ai-system/worker/repo-convention-scanner.js";

test("naming guard warns for scenario-like generated names", async () => {
  const result = await withEnv({}, async () => runNamingGuard({
    changedFiles: ["src/screens/S2HomeScreen.tsx", "src/api/OAuth2Client.ts", "src/media/H264Decoder.ts"]
  }));

  assert.equal(result.ok, true);
  assert.equal(result.findings.some((finding) => finding.filePath === "src/screens/S2HomeScreen.tsx"), true);
  assert.equal(result.findings.some((finding) => finding.filePath === "src/api/OAuth2Client.ts"), false);
  assert.equal(result.findings.some((finding) => finding.filePath === "src/media/H264Decoder.ts"), false);
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
    const artifact = JSON.parse(await fs.readFile(path.join(tmpDir, ARTIFACT_PATHS.namingCheck), "utf8"));
    assert.equal(artifact.ok, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("naming guard warns when a test-like filename misses repo conventions", async () => {
  const result = await withEnv({}, async () => runNamingGuard({
    changedFiles: ["src/payment/PaymentTestHelper.ts"],
    conventions: {
      screenPatterns: [],
      componentPatterns: [],
      hookPatterns: [],
      servicePatterns: [],
      apiClientPatterns: [],
      testPatterns: [{
        pattern: "*.test.ts",
        count: 4,
        confidence: 1,
        examples: ["src/payment/payment.test.ts"]
      }]
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.findings.some((finding) => finding.code === "CONVENTION_MISMATCH"), true);
});

test("repo convention scanner records common filename patterns", async () => {
  const repoRoot = await createGitRepo("repo-conventions-");
  const artifactDir = path.join(repoRoot, "artifact");
  try {
    await fs.mkdir(path.join(repoRoot, "src/hooks"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "src/services"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "src/screens"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "src/api"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, "dist"), { recursive: true });
    await fs.mkdir(path.join(repoRoot, ".orchestra"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "src/hooks/usePayment.ts"), "export const usePayment = () => null;\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src/services/PaymentService.ts"), "export const PaymentService = {};\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src/screens/PaymentScreen.tsx"), "export const PaymentScreen = () => null;\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src/api/PaymentApi.ts"), "export const PaymentApi = {};\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src/PaymentService.test.ts"), "export {};\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "dist/IgnoredScreen.tsx"), "export {};\n", "utf8");
    await fs.writeFile(path.join(repoRoot, ".orchestra/IgnoredApi.ts"), "export {};\n", "utf8");
    await runCommand({ command: "git", args: ["add", "."], cwd: repoRoot });
    await runCommand({ command: "git", args: ["commit", "-m", "add conventions"], cwd: repoRoot });

    const result = await scanRepoConventions(repoRoot);
    await writeRepoConventionScanArtifact(artifactDir, result);

    assert.equal(result.hookPatterns.some((pattern) => pattern.pattern === "use*.ts"), true);
    assert.equal(result.servicePatterns.some((pattern) => pattern.pattern === "*Service.ts"), true);
    assert.equal(result.screenPatterns.some((pattern) => pattern.pattern === "*Screen.tsx"), true);
    assert.equal(result.apiClientPatterns.some((pattern) => pattern.pattern === "*Api.ts"), true);
    assert.equal(result.testPatterns.some((pattern) => pattern.pattern === "*.test.ts"), true);
    assert.equal(
      [...result.screenPatterns, ...result.apiClientPatterns]
        .flatMap((pattern) => pattern.examples)
        .some((example) => example.startsWith("dist/") || example.startsWith(".orchestra/")),
      false
    );
    assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.repoConventions)));
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
