import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VectorIndex } from "../ai-system/core/vector-index.js";
import { expandContextReadFiles } from "../ai-system/core/context-intelligence.js";
import type { RulesConfig } from "../ai-system/types.js";

const execFileAsync = promisify(execFile);

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

test("VectorIndex uses symbol-aware chunks so matches stay near the relevant function", async () => {
  const repoRoot = await createTempRepo({
    "src/auth/service.ts": [
      "export function formatDisplayName(name: string) {",
      "  return name.trim().toUpperCase();",
      "}",
      "",
      "export function validateAuthToken(token: string) {",
      "  if (!token.startsWith('auth_')) {",
      "    throw new Error('invalid token');",
      "  }",
      "  return token.slice(5);",
      "}",
      "",
      "export function buildAuditMessage(userId: string) {",
      "  return `audit:${userId}`;",
      "}"
    ].join("\n")
  });

  try {
    const rules = createRules({
      vector_search: {
        enabled: true,
        data_dir: ".ai-system-vector",
        max_results: 3,
        max_indexed_files: 100,
        max_file_bytes: 64000,
        chunk_size: 400,
        chunk_overlap: 50
      }
    });
    const index = new VectorIndex({
      repoRoot,
      rules,
      config: rules.vector_search
    });

    const stats = await index.indexWorkspace();
    const matches = await index.search("Fix auth token validation failure", 2);

    assert.ok(stats.chunkCount >= 3);
    assert.equal(matches[0]?.path, "src/auth/service.ts");
    assert.match(matches[0]?.preview ?? "", /validateAuthToken/);
    assert.equal(matches[0]?.startLine, 5);
    assert.ok((matches[0]?.endLine ?? 0) >= 10);
    assert.ok((matches[0]?.endLine ?? 0) <= 11);
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
    assert.equal(result.rankedCandidates[0]?.path, "src/main.ts");
    assert.equal(result.rankedCandidates.some((entry) => entry.path === "src/auth/session.ts" && entry.sources.includes("semantic")), true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("expandContextReadFiles pulls write targets into ranked context ahead of docs", async () => {
  const repoRoot = await createTempRepo({
    "src/main.ts": "import { updateEnv } from './config/env';\nexport function start() { return updateEnv(); }\n",
    "src/config/env.ts": "export function updateEnv() { return process.env.NODE_ENV ?? 'dev'; }\n",
    "README.md": "Environment setup and deployment notes.\n"
  });

  try {
    const rules = createRules({
      max_files: 1,
      vector_search: {
        enabled: true,
        data_dir: ".ai-system-vector",
        max_results: 1,
        max_indexed_files: 100,
        max_file_bytes: 64000,
        chunk_size: 200,
        chunk_overlap: 50
      }
    });

    const result = await expandContextReadFiles({
      repoRoot,
      rules,
      task: "Fix env update logic",
      prompt: "Update the config env module safely.",
      initialReadFiles: ["src/main.ts"],
      writeTargets: ["src/config/env.ts"]
    });

    assert.deepEqual(result.readFiles.slice(0, 2), ["src/main.ts", "src/config/env.ts"]);
    assert.equal(result.rankedCandidates[1]?.path, "src/config/env.ts");
    assert.equal(result.rankedCandidates[1]?.sources.includes("write-target"), true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("VectorIndex prefers code files over roadmap docs for implementation queries", async () => {
  const repoRoot = await createTempRepo({
    "ai-system/core/tool-executor.ts":
      "export function buildToolInvocation() { return 'docker sandbox passthrough env'; }\n",
    "tasks/roadmap-v2.md":
      "# Roadmap\nImprove docker sandbox passthrough and semantic vector search for future work.\n",
    "README.md":
      "Docker sandbox passthrough notes and high level setup instructions.\n"
  });

  try {
    const rules = createRules();
    const index = new VectorIndex({
      repoRoot,
      rules,
      config: rules.vector_search
    });

    await index.indexWorkspace();
    const matches = await index.search("Fix docker sandbox passthrough environment variables", 3);

    assert.equal(matches[0]?.path, "ai-system/core/tool-executor.ts");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("VectorIndex ignores internal artifact and vector index directories", async () => {
  const repoRoot = await createTempRepo({
    "ai-system/core/tool-executor.ts": "export function buildToolInvocation() { return 'docker env'; }\n",
    ".ai-system-artifacts/run-1/01-plan/plan.json": JSON.stringify({ task: "Fix docker sandbox env" }, null, 2),
    ".ai-system-vector/index.json": JSON.stringify({ stale: true }, null, 2)
  });

  try {
    const rules = createRules({
      artifacts: {
        enabled: true,
        data_dir: ".ai-system-artifacts"
      }
    });
    const index = new VectorIndex({
      repoRoot,
      rules,
      config: rules.vector_search
    });

    await index.indexWorkspace();
    const matches = await index.search("Fix docker sandbox environment variables", 5);

    assert.equal(matches.some((match) => match.path.startsWith(".ai-system-artifacts/")), false);
    assert.equal(matches.some((match) => match.path.startsWith(".ai-system-vector/")), false);
    assert.equal(matches[0]?.path, "ai-system/core/tool-executor.ts");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("expandContextReadFiles promotes related changed files from the working tree", async () => {
  const repoRoot = await createTempRepo({
    "src/main.ts": "import { formatEnv } from './env';\nexport function start() { return formatEnv(); }\n",
    "src/env.ts": "export function formatEnv() { return 'dev'; }\n",
    "src/unrelated.ts": "export function noop() { return 'noop'; }\n"
  });

  try {
    await execGit(repoRoot, ["init"]);
    await execGit(repoRoot, ["config", "user.email", "ai@example.com"]);
    await execGit(repoRoot, ["config", "user.name", "AI System"]);
    await execGit(repoRoot, ["add", "."]);
    await execGit(repoRoot, ["commit", "-m", "initial"]);

    await fs.writeFile(path.join(repoRoot, "src/env.ts"), "export function formatEnv() { return process.env.NODE_ENV ?? 'dev'; }\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "src/unrelated.ts"), "export function noop() { return 'changed'; }\n", "utf8");

    const rules = createRules();
    const result = await expandContextReadFiles({
      repoRoot,
      rules,
      task: "Fix environment bootstrap logic",
      prompt: "Trace the environment formatting path.",
      initialReadFiles: ["src/main.ts"],
      writeTargets: []
    });

    assert.equal(result.changedHintFiles.includes("src/env.ts"), true);
    assert.equal(result.changedHintFiles.includes("src/unrelated.ts"), false);
    assert.equal(result.rankedCandidates.some((entry) => entry.path === "src/env.ts" && entry.sources.includes("changed-file")), true);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("expandContextReadFiles trims oversized low-priority context candidates by budget", async () => {
  const repoRoot = await createTempRepo({
    "src/main.ts": "import { normalizeEnv } from './env';\nexport function start() { return normalizeEnv(); }\n",
    "src/env.ts": "export function normalizeEnv() { return 'dev'; }\n",
    "src/bootstrap-guide.ts": `export const bootstrapGuide = ${JSON.stringify("environment bootstrap ".repeat(600))};\n`
  });

  try {
    const rules = createRules({
      max_context_bytes: 400,
      vector_search: {
        enabled: true,
        data_dir: ".ai-system-vector",
        max_results: 2,
        max_indexed_files: 100,
        max_file_bytes: 64000,
        chunk_size: 300,
        chunk_overlap: 50
      }
    });

    const result = await expandContextReadFiles({
      repoRoot,
      rules,
      task: "Fix environment bootstrap logic",
      prompt: "Inspect the environment bootstrap path and related docs.",
      initialReadFiles: ["src/main.ts"],
      writeTargets: []
    });

    assert.equal(result.readFiles.includes("src/main.ts"), true);
    assert.equal(result.readFiles.includes("src/env.ts"), true);
    assert.equal(result.budgetTrimmedFiles.includes("src/bootstrap-guide.ts"), true);
    assert.equal(result.readFiles.includes("src/bootstrap-guide.ts"), false);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

async function execGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
