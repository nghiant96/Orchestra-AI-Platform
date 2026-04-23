import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildFixChecksTask, prepareFixChecksTask } from "../ai-system/core/fix-checks.js";
import { createLogger } from "../ai-system/utils/logger.js";

async function createTempRepo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-fix-checks-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
  return root;
}

test("buildFixChecksTask includes failing check output and file hints", () => {
  const task = buildFixChecksTask(
    [
      {
        name: "lint",
        kind: "command",
        ok: false,
        skipped: false,
        issueCount: 1,
        durationMs: 12,
        summary: "lint failed.",
        command: "pnpm",
        args: ["lint"],
        stderr: "src/auth.ts:1 missing semicolon"
      }
    ],
    ["src/auth.ts"]
  );

  assert.match(task, /Failing checks:/);
  assert.match(task, /lint failed/);
  assert.match(task, /Likely related files: src\/auth\.ts/);
});

test("prepareFixChecksTask returns null when checks are green", async () => {
  const repoRoot = await createTempRepo({
    ".ai-system.json": JSON.stringify({
      tools: {
        enabled: true,
        commands: {
          lint: {
            enabled: true,
            command: "node",
            args: ["-e", "process.exit(0)"]
          },
          typecheck: { enabled: false },
          build: { enabled: false },
          test: { enabled: false }
        }
      }
    }),
    "src/index.ts": "export const ok = true;\n"
  });

  try {
    const result = await prepareFixChecksTask({
      repoRoot,
      configPath: null,
      providerPreset: null,
      logger: createLogger({ verbose: false })
    });

    assert.equal(result, null);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("prepareFixChecksTask collects failing checks and extracts file hints", async () => {
  const repoRoot = await createTempRepo({
    ".ai-system.json": JSON.stringify({
      tools: {
        enabled: true,
        commands: {
          lint: {
            enabled: true,
            command: "node",
            args: ["-e", "console.error('src/auth.ts:3 Missing semicolon'); process.exit(1)"]
          },
          typecheck: { enabled: false },
          build: { enabled: false },
          test: { enabled: false }
        }
      }
    }),
    "src/auth.ts": "export const broken = true\n"
  });

  try {
    const result = await prepareFixChecksTask({
      repoRoot,
      configPath: null,
      providerPreset: null,
      logger: createLogger({ verbose: false })
    });

    assert.ok(result);
    assert.equal(result?.failingChecks.length, 1);
    assert.deepEqual(result?.fileHints, ["src/auth.ts"]);
    assert.match(result?.task ?? "", /src\/auth\.ts/);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
