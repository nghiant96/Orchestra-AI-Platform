import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runToolChecks, summarizeConfiguredTools } from "../ai-system/core/tool-executor.js";
import type { GeneratedFile, RulesConfig } from "../ai-system/types.js";

test("runToolChecks validates generated JSON and records a high-severity issue", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-json-"));

  try {
    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles: [{ path: "config.json", content: "{ invalid json" }],
      rules: createRules({
        tools: {
          enabled: false,
          json_validation: true
        }
      })
    });

    assert.equal(summary.results[0]?.name, "json-validation");
    assert.equal(summary.results[0]?.ok, false);
    assert.equal(summary.issues.length, 1);
    assert.equal(summary.issues[0]?.severity, "high");
    assert.match(summary.issues[0]?.description ?? "", /invalid json syntax/i);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks auto-detects npm scripts and stores structured command results", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-scripts-"));
  const changedFiles: GeneratedFile[] = [{ path: "src/example.ts", content: "export const value = 1;\n" }];

  try {
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "tool-checks-test",
          private: true,
          scripts: {
            lint: "node ./scripts/lint.js",
            build: "node ./scripts/build.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(tempDir, "scripts", "lint.js"), "process.exit(0);\n", "utf8");
    await fs.writeFile(path.join(tempDir, "scripts", "build.js"), "console.error('build failed'); process.exit(1);\n", "utf8");

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules: createRules({
        tools: {
          enabled: true,
          json_validation: true,
          commands: {
            lint: { enabled: true },
            typecheck: { enabled: false },
            build: { enabled: true },
            test: { enabled: false }
          }
        }
      })
    });

    const lintResult = summary.results.find((entry) => entry.name === "lint");
    const buildResult = summary.results.find((entry) => entry.name === "build");
    const testResult = summary.results.find((entry) => entry.name === "test");

    assert.equal(lintResult?.ok, true);
    assert.equal(lintResult?.skipped, false);
    assert.deepEqual(lintResult?.args, ["run", "lint"]);

    assert.equal(buildResult?.ok, false);
    assert.equal(buildResult?.skipped, false);
    assert.deepEqual(buildResult?.args, ["run", "build"]);
    assert.equal(summary.issues.length, 1);
    assert.equal(summary.issues[0]?.category, "tool:build");
    assert.match(summary.issues[0]?.description ?? "", /build failed/i);

    assert.equal(testResult?.skipped, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks supports changed-file placeholders in configured script args", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-scoped-"));
  const changedFiles: GeneratedFile[] = [
    { path: "src/a.ts", content: "export const a = 1;\n" },
    { path: "src/b.ts", content: "export const b = 2;\n" }
  ];

  try {
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "tool-scoped-test",
          private: true,
          scripts: {
            "lint:changed": "node ./scripts/print-args.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "scripts", "print-args.js"),
      "console.log(process.argv.slice(2).join('|')); process.exit(0);\n",
      "utf8"
    );

    const rules = createRules({
      tools: {
        enabled: true,
        json_validation: true,
        commands: {
          lint: {
            enabled: true,
            script: "lint:changed",
            args: ["{changed_files}"]
          },
          typecheck: { enabled: false },
          build: { enabled: false },
          test: { enabled: false }
        }
      }
    });

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules
    });
    const lintResult = summary.results.find((entry) => entry.name === "lint");
    const toolConfig = await summarizeConfiguredTools({ repoRoot: tempDir, rules });
    const lintConfig = toolConfig.find((entry) => entry.name === "lint");

    assert.equal(lintResult?.ok, true);
    assert.deepEqual(lintResult?.args, ["run", "lint:changed", "--", "src/a.ts", "src/b.ts"]);
    assert.match(lintResult?.stdout ?? "", /src\/a\.ts\|src\/b\.ts/);
    assert.equal(lintConfig?.scopedToChangedFiles, true);
    assert.equal(lintConfig?.source, "configured-script");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks auto-detects scoped lint/test scripts for changed files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-auto-scoped-"));
  const changedFiles: GeneratedFile[] = [{ path: "src/example.test.ts", content: "export const value = 1;\n" }];

  try {
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "tool-auto-scoped-test",
          private: true,
          scripts: {
            "lint:changed": "node ./scripts/print-args.js",
            "test:related": "node ./scripts/print-args.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "scripts", "print-args.js"),
      "console.log(process.argv.slice(2).join('|')); process.exit(0);\n",
      "utf8"
    );

    const rules = createRules({
      tools: {
        enabled: true,
        json_validation: true,
        commands: {
          lint: { enabled: true },
          typecheck: { enabled: false },
          build: { enabled: false },
          test: { enabled: true }
        }
      }
    });

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules
    });

    const lintResult = summary.results.find((entry) => entry.name === "lint");
    const testResult = summary.results.find((entry) => entry.name === "test");

    assert.equal(lintResult?.ok, true);
    assert.equal(lintResult?.scope, "changed-files");
    assert.deepEqual(lintResult?.args, ["run", "lint:changed", "--", "src/example.test.ts"]);

    assert.equal(testResult?.ok, true);
    assert.equal(testResult?.scope, "changed-files");
    assert.deepEqual(testResult?.args, ["run", "test:related", "--", "src/example.test.ts"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks scopes lint/test to a single changed workspace package", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-package-scope-"));
  const changedFiles: GeneratedFile[] = [{ path: "packages/web/src/example.ts", content: "export const value = 1;\n" }];

  try {
    await fs.mkdir(path.join(tempDir, "packages/web/scripts"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "workspace-root", private: true }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/web/package.json"),
      JSON.stringify(
        {
          name: "@workspace/web",
          private: true,
          scripts: {
            lint: "node ./scripts/print-cwd.js",
            test: "node ./scripts/print-cwd.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/web/scripts/print-cwd.js"),
      "console.log(process.cwd()); process.exit(0);\n",
      "utf8"
    );

    const rules = createRules({
      tools: {
        enabled: true,
        json_validation: true,
        commands: {
          lint: { enabled: true },
          typecheck: { enabled: false },
          build: { enabled: false },
          test: { enabled: true }
        }
      }
    });

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules
    });

    const lintResult = summary.results.find((entry) => entry.name === "lint");
    const testResult = summary.results.find((entry) => entry.name === "test");

    assert.equal(lintResult?.ok, true);
    assert.equal(lintResult?.scope, "package");
    assert.equal(lintResult?.workingDirectory, "packages/web");
    assert.deepEqual(lintResult?.args, ["run", "lint"]);
    assert.match(lintResult?.stdout ?? "", /packages[\/\\]web/);

    assert.equal(testResult?.ok, true);
    assert.equal(testResult?.scope, "package");
    assert.equal(testResult?.workingDirectory, "packages/web");
    assert.deepEqual(testResult?.args, ["run", "test"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks scopes typecheck to a single changed workspace package when it has a tsconfig", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-package-typecheck-"));
  const changedFiles: GeneratedFile[] = [{ path: "packages/web/src/example.ts", content: "export const value = 1;\n" }];

  try {
    await fs.mkdir(path.join(tempDir, "node_modules/typescript/bin"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "packages/web/src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "workspace-root", private: true }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/web/package.json"),
      JSON.stringify({ name: "@workspace/web", private: true }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/web/tsconfig.json"),
      JSON.stringify({ compilerOptions: { noEmit: true } }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "node_modules/typescript/bin/tsc"),
      "console.log(process.cwd()); console.log(process.argv.slice(2).join('|')); process.exit(0);\n",
      "utf8"
    );

    const rules = createRules({
      tools: {
        enabled: true,
        json_validation: true,
        commands: {
          lint: { enabled: false },
          typecheck: { enabled: true },
          build: { enabled: false },
          test: { enabled: false }
        }
      }
    });

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules
    });
    const typecheckResult = summary.results.find((entry) => entry.name === "typecheck");
    assert.equal(typecheckResult?.ok, true);
    assert.equal(typecheckResult?.scope, "package");
    assert.equal(typecheckResult?.workingDirectory, "packages/web");
    assert.match(typecheckResult?.stdout ?? "", /packages[\/\\]web/);
    assert.ok(typecheckResult?.args?.includes(path.join(tempDir, "packages/web/tsconfig.json")));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks uses pnpm workspace filters when changes span multiple packages", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-workspace-scope-"));
  const changedFiles: GeneratedFile[] = [
    { path: "packages/web/src/example.ts", content: "export const web = 1;\n" },
    { path: "packages/api/src/example.ts", content: "export const api = 1;\n" }
  ];

  try {
    await fs.mkdir(path.join(tempDir, "packages/web/scripts"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "packages/api/scripts"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(path.join(tempDir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "workspace-root", private: true }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/web/package.json"),
      JSON.stringify(
        {
          name: "@workspace/web",
          private: true,
          scripts: {
            lint: "node ./scripts/print-package.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/api/package.json"),
      JSON.stringify(
        {
          name: "@workspace/api",
          private: true,
          scripts: {
            lint: "node ./scripts/print-package.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/web/scripts/print-package.js"),
      "console.log(process.cwd()); process.exit(0);\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "packages/api/scripts/print-package.js"),
      "console.log(process.cwd()); process.exit(0);\n",
      "utf8"
    );

    const rules = createRules({
      tools: {
        enabled: true,
        json_validation: true,
        commands: {
          lint: { enabled: true },
          typecheck: { enabled: false },
          build: { enabled: false },
          test: { enabled: false }
        }
      }
    });

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules
    });
    const lintResult = summary.results.find((entry) => entry.name === "lint");

    assert.equal(lintResult?.ok, true);
    assert.equal(lintResult?.scope, "workspace");
    assert.match(lintResult?.workingDirectory ?? "", /packages\/web/);
    assert.match(lintResult?.workingDirectory ?? "", /packages\/api/);
    assert.deepEqual(lintResult?.args, ["--filter", "@workspace/web", "--filter", "@workspace/api", "run", "lint"]);
    assert.match(lintResult?.stdout ?? "", /packages[\/\\]web/);
    assert.match(lintResult?.stdout ?? "", /packages[\/\\]api/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function createRules(override: Partial<RulesConfig> = {}): RulesConfig {
  return {
    max_iterations: 3,
    max_files: 5,
    max_write_files: 8,
    token_limit_hint: 12000,
    max_context_bytes: 60000,
    request_timeout_ms: 60000,
    request_retries: 3,
    retry_base_delay_ms: 500,
    memory: {
      enabled: false,
      backend: "local-file"
    },
    providers: {
      planner: { type: "gemini-cli" },
      reviewer: { type: "gemini-cli" },
      generator: { type: "codex-cli" },
      fixer: { type: "codex-cli" }
    },
    tools: {
      enabled: true,
      json_validation: true,
      commands: {
        lint: { enabled: true },
        typecheck: { enabled: true },
        build: { enabled: false },
        test: { enabled: false }
      }
    },
    ...override
  };
}
