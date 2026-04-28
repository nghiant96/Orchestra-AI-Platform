import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadPromptExamplesForTask, loadPromptTemplate } from "../ai-system/utils/prompt-loader.js";
import type { RulesConfig } from "../ai-system/types.js";

test("project prompt override wins over built-in template", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-prompts-"));
  try {
    await fs.mkdir(path.join(repoRoot, ".ai-system-prompts"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, ".ai-system-prompts", "planner.md"), "Custom planner {{max_files}}\n", "utf8");
    const template = await loadPromptTemplate("planner", {
      repoRoot,
      rules: createRules({
        prompts: {
          directory: ".ai-system-prompts"
        }
      })
    });
    assert.equal(template.trim(), "Custom planner {{max_files}}");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("missing custom prompt falls back to built-in template", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-prompts-fallback-"));
  try {
    const template = await loadPromptTemplate("planner", {
      repoRoot,
      rules: createRules({
        prompts: {
          directory: ".missing-prompts"
        }
      })
    });
    assert.match(template, /Select at most/);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("unsafe custom prompt paths are rejected", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-prompts-unsafe-"));
  try {
    await assert.rejects(
      () =>
        loadPromptTemplate("planner", {
          repoRoot,
          rules: createRules({
            prompts: {
              templates: {
                planner: "../outside.md"
              }
            }
          })
        }),
      /Unsafe prompt path/
    );
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("custom examples directory is injected", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-prompts-examples-"));
  try {
    await fs.mkdir(path.join(repoRoot, ".ai-system-prompts", "examples"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, ".ai-system-prompts", "examples", "refactor.md"), "Custom refactor example\n", "utf8");
    const examples = await loadPromptExamplesForTask("refactor service", [], {
      repoRoot,
      rules: createRules({
        prompts: {
          examples_directory: ".ai-system-prompts/examples"
        }
      })
    });
    assert.equal(examples.trim(), "Custom refactor example");
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

function createRules(override: Partial<RulesConfig> = {}): RulesConfig {
  return {
    max_iterations: 1,
    max_files: 5,
    max_context_bytes: 10000,
    request_timeout_ms: 1000,
    request_retries: 0,
    retry_base_delay_ms: 0,
    memory: {},
    providers: {
      planner: { type: "local" },
      reviewer: { type: "local" },
      generator: { type: "local" },
      fixer: { type: "local" }
    },
    ...override
  };
}
