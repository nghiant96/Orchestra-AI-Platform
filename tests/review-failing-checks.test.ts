import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { reviewFailingChecks } from "../ai-system/core/review-failing-checks.js";
import { createLogger } from "../ai-system/utils/logger.js";

async function createTempRepo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-review-failing-checks-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
  return root;
}

test("reviewFailingChecks returns null when repo checks are green", async () => {
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
    const result = await reviewFailingChecks({
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
