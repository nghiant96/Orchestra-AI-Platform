import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { VectorIndex } from "../ai-system/core/vector-index.js";
import { expandContextReadFiles } from "../ai-system/core/context-intelligence.js";
import type { RulesConfig } from "../ai-system/types.js";

async function createTempRepo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-vector-index-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
  return root;
}

function createRules(overrides: Partial<RulesConfig> = {}): RulesConfig {
  return {
    max_iterations: 3,
    max_files: 8,
    max_write_files: 8,
    token_limit_hint: 12000,
    max_tree_entries: 400,
    max_context_bytes: 60000,
    request_timeout_ms: 60000,
    request_retries: 1,
    retry_base_delay_ms: 250,
    memory: {
      enabled: false,
      backend: "local-file"
    },
    vector_search: {
      enabled: true,
      data_dir: ".ai-system-vector",
      max_results: 3,
      max_indexed_files: 100,
      max_file_bytes: 64000,
      chunk_size: 200,
      chunk_overlap: 50
    },
    providers: {
      planner: { type: "codex-cli" },
      reviewer: { type: "codex-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    },
    excluded_directories: [".git", "node_modules", ".ai-system-vector"],
    sensitive_file_names: [".env"],
    ...overrides
  };
}

test("VectorIndex indexes chunks and finds semantically relevant auth files", async () => {
  const repoRoot = await createTempRepo({
    "src/auth/session.ts": "export function validateAuthToken(token: string) { return token.startsWith('auth_'); }\n",
    "src/ui/button.ts": "export function Button() { return '<button>Click</button>'; }\n",
    "README.md": "# Example project\nGeneral UI notes.\n"
  });

  try {
    const rules = createRules();
    const index = new VectorIndex({
      repoRoot,
      rules,
      config: rules.vector_search
    });

    const stats = await index.indexWorkspace();
    const matches = await index.search("Fix the authentication token validation bug", 2);

    assert.ok(stats.fileCount >= 2);
    assert.ok(stats.chunkCount >= 2);
    assert.equal(matches.length > 0, true);
    assert.equal(matches[0]?.path, "src/auth/session.ts");
    assert.match(matches[0]?.preview ?? "", /validateAuthToken/);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("expandContextReadFiles adds vector-matched files even when planner misses them", async () => {
  const repoRoot = await createTempRepo({
    "src/main.ts": "export function startApp() { return 'ready'; }\n",
    "src/auth/session.ts": "export function validateAuthToken(token: string) { return token.startsWith('auth_'); }\n",
    "src/utils/logger.ts": "export const log = console.log;\n"
  });

  try {
    const rules = createRules();
    const result = await expandContextReadFiles({
      repoRoot,
      rules,
      task: "Fix the authentication token validation bug",
      prompt: "Trace the auth token handling flow.",
      initialReadFiles: ["src/main.ts"],
      writeTargets: ["src/auth/session.ts"]
    });

    assert.ok(result.readFiles.includes("src/main.ts"));
    assert.ok(result.readFiles.includes("src/auth/session.ts"));
    assert.equal(result.vectorMatches.some((match) => match.path === "src/auth/session.ts"), true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
