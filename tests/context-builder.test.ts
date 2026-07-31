import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ARTIFACT_PATHS } from "../ai-system/artifacts/artifact-paths.js";
import { buildContext } from "../ai-system/context/context-builder.js";
import { buildMemoryNamespace } from "../ai-system/memory/memory-namespace.js";
import { runCommand } from "../ai-system/utils/api.js";
import type { SemanticContextProvider } from "../ai-system/context/semantic-context-provider.js";
import { removeTempDir } from "./test-utils.js";

test("context builder ranks ripgrep, convention, and semantic candidates and writes pre-context artifacts", async () => {
  const repoRoot = await createGitRepo("context-builder-");
  const artifactDir = path.join(repoRoot, ".orchestra", "jobs", "job-context-builder");
  const provider = fakeSemanticProvider();

  try {
    const built = await buildContext({
      jobId: "job-context-builder",
      task: "Refactor the payment API client and update tests.",
      repoRoot,
      artifactDir
    }, {
      semanticProvider: provider,
      candidateLimit: 6
    });

    assert.ok(built.candidates.length > 0);
    assert.equal(built.preContextPack.jobId, "job-context-builder");
    assert.match(built.preContextPack.summary, /payment/i);
    assert.ok(built.candidates.some((candidate) => candidate.path === "src/payment/api.ts"));
    assert.ok(built.candidates.some((candidate) => candidate.source === "vector"));
    assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.preContextPack)));
    assert.ok(await exists(path.join(artifactDir, ARTIFACT_PATHS.preContextPackMarkdown)));
    assert.match(await fs.readFile(path.join(artifactDir, ARTIFACT_PATHS.preContextPackMarkdown), "utf8"), /Worker Context Pack/);

    const namespace = await buildMemoryNamespace(repoRoot);
    assert.equal(namespace.scope, "project");
    assert.equal(namespace.workspaceRootHash.length, 16);
    assert.equal(namespace.projectId.length > 0, true);
  } finally {
    await removeTempDir(repoRoot);
  }
});

test("context builder keeps the allowed diff boundary tight around nested files", async () => {
  const repoRoot = await createGitRepo("context-boundary-");

  try {
    const built = await buildContext({
      jobId: "job-context-boundary",
      task: "Update the payment button and supporting component structure.",
      repoRoot,
      artifactDir: path.join(repoRoot, ".orchestra", "jobs", "job-context-boundary")
    }, {
      candidateLimit: 4
    });

    assert.ok(built.preContextPack.allowedDiffBoundary.some((boundary) => boundary === "dashboard/src/**" || boundary === "src/payment/**" || boundary === "src/payment/components/**"));
    assert.equal(built.preContextPack.allowedDiffBoundary.some((boundary) => boundary === "dashboard/**"), false);
  } finally {
    await removeTempDir(repoRoot);
  }
});

function fakeSemanticProvider(): SemanticContextProvider {
  return {
    async search() {
      return [
        {
          path: "src/semantic/payment-helper.ts",
          reason: "Semantic memory match for payment refactor",
          source: "vector",
          score: 9
        }
      ];
    }
  };
}

async function createGitRepo(prefix: string): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await runCommand({ command: "git", args: ["init"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.email", "test@example.com"], cwd: repoRoot });
  await runCommand({ command: "git", args: ["config", "user.name", "Test User"], cwd: repoRoot });
  await fs.mkdir(path.join(repoRoot, "src", "payment"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "src", "auth"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "tests"), { recursive: true });
  await fs.mkdir(path.join(repoRoot, "dashboard", "src", "components"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "src", "payment", "api.ts"), "export const paymentApi = true;\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "src", "auth", "session.ts"), "export const session = true;\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "tests", "payment.test.ts"), "describe('payment', () => {});\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "dashboard", "src", "components", "PaymentButton.tsx"), "export const PaymentButton = () => null;\n", "utf8");
  await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify({
    name: "context-builder-test",
    private: true,
    type: "module"
  }, null, 2), "utf8");
  await runCommand({ command: "git", args: ["add", "."], cwd: repoRoot });
  await runCommand({ command: "git", args: ["commit", "-m", "init"], cwd: repoRoot });
  return repoRoot;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
