import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDryRunToolExecutionSummary, runToolChecks, summarizeConfiguredTools } from "../ai-system/core/tool-executor.js";
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
    assert.match(lintResult?.stdout ?? "", /packages[/\\]web/);

    assert.equal(testResult?.ok, true);
    assert.equal(testResult?.scope, "package");
    assert.equal(testResult?.workingDirectory, "packages/web");
    assert.deepEqual(testResult?.args, ["run", "test"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks prefers the changed package lint script over the root lint script", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-package-root-precedence-"));
  const changedFiles: GeneratedFile[] = [{ path: "dashboard/src/App.tsx", content: "export const App = () => null;\n" }];

  try {
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "dashboard/scripts"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "workspace-root",
          private: true,
          scripts: {
            lint: "node ./scripts/root-lint.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "dashboard/package.json"),
      JSON.stringify(
        {
          name: "dashboard",
          private: true,
          scripts: {
            lint: "node ./scripts/package-lint.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(tempDir, "scripts/root-lint.js"), "console.log('root lint'); process.exit(1);\n", "utf8");
    await fs.writeFile(path.join(tempDir, "dashboard/scripts/package-lint.js"), "console.log(process.cwd()); process.exit(0);\n", "utf8");

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
            build: { enabled: false },
            test: { enabled: false }
          }
        }
      })
    });

    const lintResult = summary.results.find((entry) => entry.name === "lint");
    assert.equal(lintResult?.ok, true);
    assert.equal(lintResult?.scope, "package");
    assert.equal(lintResult?.workingDirectory, "dashboard");
    assert.deepEqual(lintResult?.args, ["run", "lint"]);
    assert.match(lintResult?.stdout ?? "", /dashboard/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks scopes generic package eslint scripts to changed files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-package-eslint-scope-"));
  const changedFiles: GeneratedFile[] = [{ path: "dashboard/src/App.tsx", content: "export const App = () => null;\n" }];
  const previousPath = process.env.PATH;

  try {
    await fs.mkdir(path.join(tempDir, "dashboard/bin"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "workspace-root", private: true }, null, 2), "utf8");
    await fs.writeFile(
      path.join(tempDir, "dashboard/package.json"),
      JSON.stringify(
        {
          name: "dashboard",
          private: true,
          scripts: {
            lint: "eslint ."
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await fs.writeFile(
      path.join(tempDir, "dashboard/bin/pnpm"),
      "#!/usr/bin/env node\nconsole.log(process.argv.slice(2).join('|')); process.exit(0);\n",
      "utf8"
    );
    await fs.chmod(path.join(tempDir, "dashboard/bin/pnpm"), 0o755);
    process.env.PATH = `${path.join(tempDir, "dashboard/bin")}:${previousPath ?? ""}`;

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
            build: { enabled: false },
            test: { enabled: false }
          }
        }
      })
    });

    const lintResult = summary.results.find((entry) => entry.name === "lint");
    assert.equal(lintResult?.ok, true);
    assert.equal(lintResult?.scope, "changed-files");
    assert.equal(lintResult?.workingDirectory, "dashboard");
    assert.deepEqual(lintResult?.args, ["exec", "eslint", "src/App.tsx"]);
    assert.match(lintResult?.stdout ?? "", /exec\|eslint\|src\/App\.tsx/);

  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
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
    assert.match(typecheckResult?.stdout ?? "", /packages[/\\]web/);
    assert.ok(typecheckResult?.args?.includes(path.join(tempDir, "packages/web/tsconfig.json")));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks prefers a changed package tsconfig over the root typecheck script", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-package-typecheck-precedence-"));
  const changedFiles: GeneratedFile[] = [{ path: "dashboard/src/App.tsx", content: "export const App = () => null;\n" }];

  try {
    await fs.mkdir(path.join(tempDir, "node_modules/typescript/bin"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "dashboard/src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "workspace-root",
          private: true,
          scripts: {
            typecheck: "node -e \"console.log('root typecheck'); process.exit(1)\""
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "dashboard/package.json"),
      JSON.stringify({ name: "dashboard", private: true }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "dashboard/tsconfig.json"),
      JSON.stringify({ compilerOptions: { noEmit: true } }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "node_modules/typescript/bin/tsc"),
      "console.log(process.cwd()); console.log(process.argv.slice(2).join('|')); process.exit(0);\n",
      "utf8"
    );

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules: createRules({
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
      })
    });

    const typecheckResult = summary.results.find((entry) => entry.name === "typecheck");
    assert.equal(typecheckResult?.ok, true);
    assert.equal(typecheckResult?.scope, "package");
    assert.equal(typecheckResult?.workingDirectory, "dashboard");
    assert.match(typecheckResult?.stdout ?? "", /dashboard/);
    assert.ok(typecheckResult?.args?.includes(path.join(tempDir, "dashboard/tsconfig.json")));
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
    assert.match(lintResult?.stdout ?? "", /packages[/\\]web/);
    assert.match(lintResult?.stdout ?? "", /packages[/\\]api/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks supports clean-env sandbox mode with explicit env passthrough", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-sandbox-"));
  const changedFiles: GeneratedFile[] = [{ path: "src/example.ts", content: "export const value = 1;\n" }];
  const previousSecret = process.env.AI_SYSTEM_TOOL_SANDBOX_SECRET;
  process.env.AI_SYSTEM_TOOL_SANDBOX_SECRET = "visible-in-clean-env";

  try {
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "tool-sandbox-test",
          private: true,
          scripts: {
            lint: "node ./scripts/print-env.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "scripts", "print-env.js"),
      "console.log(process.env.AI_SYSTEM_TOOL_SANDBOX_SECRET ?? 'missing'); process.exit(0);\n",
      "utf8"
    );

    const rules = createRules({
      tools: {
        enabled: true,
        json_validation: true,
        sandbox: {
          mode: "clean-env",
          include_env: ["AI_SYSTEM_TOOL_SANDBOX_SECRET"]
        },
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
    const toolConfig = await summarizeConfiguredTools({ repoRoot: tempDir, rules });
    const lintConfig = toolConfig.find((entry) => entry.name === "lint");

    assert.equal(lintResult?.ok, true);
    assert.equal(lintResult?.sandboxMode, "clean-env");
    assert.match(lintResult?.stdout ?? "", /visible-in-clean-env/);
    assert.equal(lintConfig?.sandboxMode, "clean-env");
    assert.match(lintConfig?.summary ?? "", /sandbox=clean-env/);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.AI_SYSTEM_TOOL_SANDBOX_SECRET;
    } else {
      process.env.AI_SYSTEM_TOOL_SANDBOX_SECRET = previousSecret;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("summarizeConfiguredTools auto-detects Python Go and Rust test adapters", async () => {
  const scenarios = [
    { projectType: "python", detectFile: "pyproject.toml", command: "pytest", args: [] },
    { projectType: "go", detectFile: "go.mod", command: "go", args: ["test", "./..."] },
    { projectType: "rust", detectFile: "Cargo.toml", command: "cargo", args: ["test"] }
  ] as const;

  for (const scenario of scenarios) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ai-system-tool-${scenario.projectType}-adapter-`));
    try {
      await fs.writeFile(path.join(tempDir, scenario.detectFile), "", "utf8");
      const summaries = await summarizeConfiguredTools({
        repoRoot: tempDir,
        rules: createRules({
          tools: {
            enabled: true,
            json_validation: true,
            project_type: scenario.projectType,
            commands: {
              lint: { enabled: false },
              typecheck: { enabled: false },
              build: { enabled: false },
              test: { enabled: true }
            }
          }
        })
      });
      const testSummary = summaries.find((entry) => entry.name === "test");
      assert.equal(testSummary?.enabled, true);
      assert.equal(testSummary?.source, "adapter");
      assert.equal(testSummary?.command, scenario.command);
      assert.deepEqual(testSummary?.args, scenario.args);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
});

test("runToolChecks preserves sandbox settings for configured non-Node adapters", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-configured-adapter-"));
  const previousSecret = process.env.AI_SYSTEM_ADAPTER_SECRET;
  process.env.AI_SYSTEM_ADAPTER_SECRET = "adapter-secret-visible";

  try {
    await fs.writeFile(path.join(tempDir, "pyproject.toml"), "[project]\nname = \"demo\"\n", "utf8");
    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles: [{ path: "src/app.py", content: "print('ok')\n" }],
      rules: createRules({
        tools: {
          enabled: true,
          json_validation: false,
          project_type: "python",
          sandbox: {
            mode: "clean-env",
            include_env: ["AI_SYSTEM_ADAPTER_SECRET"]
          },
          adapters: {
            python: {
              detect_files: ["pyproject.toml"],
              changed_file_extensions: [".py"],
              commands: {
                test: {
                  command: "node",
                  args: ["-e", "console.log(process.env.AI_SYSTEM_ADAPTER_SECRET ?? 'missing')"]
                }
              }
            }
          },
          commands: {
            lint: { enabled: false },
            typecheck: { enabled: false },
            build: { enabled: false },
            test: { enabled: true }
          }
        }
      })
    });

    const testResult = summary.results.find((entry) => entry.name === "test");
    assert.equal(testResult?.ok, true);
    assert.equal(testResult?.sandboxMode, "clean-env");
    assert.equal(testResult?.workingDirectory, ".");
    assert.match(testResult?.stdout ?? "", /adapter-secret-visible/);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.AI_SYSTEM_ADAPTER_SECRET;
    } else {
      process.env.AI_SYSTEM_ADAPTER_SECRET = previousSecret;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks lets explicit tool commands override detected adapters", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-adapter-precedence-"));

  try {
    await fs.writeFile(path.join(tempDir, "pyproject.toml"), "[project]\nname = \"demo\"\n", "utf8");
    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles: [{ path: "src/app.py", content: "print('ok')\n" }],
      rules: createRules({
        tools: {
          enabled: true,
          json_validation: false,
          project_type: "python",
          commands: {
            lint: { enabled: false },
            typecheck: { enabled: false },
            build: { enabled: false },
            test: {
              enabled: true,
              command: "node",
              args: ["-e", "console.log('configured command wins')"]
            }
          }
        }
      })
    });

    const testResult = summary.results.find((entry) => entry.name === "test");
    assert.equal(testResult?.ok, true);
    assert.equal(testResult?.command, "node");
    assert.deepEqual(testResult?.args, ["-e", "console.log('configured command wins')"]);
    assert.match(testResult?.stdout ?? "", /configured command wins/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks skips non-Node typecheck when adapter has no typecheck command", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-adapter-typecheck-skip-"));

  try {
    await fs.writeFile(path.join(tempDir, "pyproject.toml"), "[project]\nname = \"demo\"\n", "utf8");
    await fs.writeFile(path.join(tempDir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }), "utf8");
    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles: [{ path: "src/app.py", content: "print('ok')\n" }],
      rules: createRules({
        tools: {
          enabled: true,
          json_validation: false,
          project_type: "python",
          commands: {
            lint: { enabled: false },
            typecheck: { enabled: true },
            build: { enabled: false },
            test: { enabled: false }
          }
        }
      })
    });

    const typecheckResult = summary.results.find((entry) => entry.name === "typecheck");
    assert.equal(typecheckResult?.skipped, true);
    assert.match(typecheckResult?.summary ?? "", /no configured or detected command/i);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks builds a safe docker invocation for workspace-scoped checks", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-docker-workspace-"));
  const changedFiles: GeneratedFile[] = [
    { path: "packages/web/src/example.ts", content: "export const web = 1;\n" },
    { path: "packages/api/src/example.ts", content: "export const api = 1;\n" }
  ];
  const previousPath = process.env.PATH;
  const previousSecret = process.env.AI_SYSTEM_TOOL_DOCKER_SECRET;
  process.env.AI_SYSTEM_TOOL_DOCKER_SECRET = "visible-in-docker";

  try {
    await fs.mkdir(path.join(tempDir, "bin"), { recursive: true });
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
      path.join(tempDir, "bin/docker"),
      "#!/usr/bin/env node\nconsole.log(`ARGS:${process.argv.slice(2).join('|')}`); console.log(`ENV:${process.env.AI_SYSTEM_TOOL_DOCKER_SECRET ?? 'missing'}`); process.exit(0);\n",
      "utf8"
    );
    await fs.chmod(path.join(tempDir, "bin/docker"), 0o755);
    process.env.PATH = `${path.join(tempDir, "bin")}:${previousPath ?? ""}`;

    const rules = createRules({
      tools: {
        enabled: true,
        json_validation: true,
        sandbox: {
          mode: "docker",
          image: "custom-image",
          include_env: ["AI_SYSTEM_TOOL_DOCKER_SECRET"]
        },
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
    assert.equal(lintResult?.sandboxMode, "docker");
    assert.match(lintResult?.stdout ?? "", /ARGS:run\|--rm\|.*\|--env\|AI_SYSTEM_TOOL_DOCKER_SECRET\|/);
    assert.match(lintResult?.stdout ?? "", /\|-w\|\/workspace\|custom-image\|pnpm\|--filter\|@workspace\/web\|--filter\|@workspace\/api\|run\|lint/);
    assert.doesNotMatch(lintResult?.stdout ?? "", /AI_SYSTEM_TOOL_DOCKER_SECRET=visible-in-docker/);
    assert.match(lintResult?.stdout ?? "", /ENV:visible-in-docker/);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousSecret === undefined) {
      delete process.env.AI_SYSTEM_TOOL_DOCKER_SECRET;
    } else {
      process.env.AI_SYSTEM_TOOL_DOCKER_SECRET = previousSecret;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks skips docker sandbox when docker is unavailable", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-docker-missing-"));
  const previousPath = process.env.PATH;

  try {
    await fs.mkdir(path.join(tempDir, "empty-bin"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "docker-missing", scripts: { lint: "echo lint" } }, null, 2),
      "utf8"
    );
    process.env.PATH = path.join(tempDir, "empty-bin");

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles: [{ path: "src/app.ts", content: "export const value = 1;\n" }],
      rules: createRules({
        tools: {
          enabled: true,
          json_validation: false,
          sandbox: { mode: "docker" },
          commands: {
            lint: { enabled: true },
            typecheck: { enabled: false },
            build: { enabled: false },
            test: { enabled: false }
          }
        }
      })
    });

    const lintResult = summary.results.find((entry) => entry.name === "lint");
    assert.equal(lintResult?.skipped, true);
    assert.match(lintResult?.summary ?? "", /Docker is unavailable/);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks auto-builds missing docker image when enabled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-docker-autobuild-"));
  const previousPath = process.env.PATH;
  const dockerLog = path.join(tempDir, "docker.log");

  try {
    await fs.mkdir(path.join(tempDir, "bin"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "docker-autobuild", scripts: { lint: "echo lint" } }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(tempDir, "pyproject.toml"), "[project]\nname = \"docker-autobuild\"\n", "utf8");
    await fs.writeFile(path.join(tempDir, "Dockerfile.tools"), "FROM scratch\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "bin/docker"),
      [
        "#!/usr/bin/env node",
        "const fs = require('fs');",
        `fs.appendFileSync(${JSON.stringify(dockerLog)}, process.argv.slice(2).join('|') + '\\n');`,
        "const args = process.argv.slice(2);",
        "if (args[0] === '--version') process.exit(0);",
        "if (args[0] === 'image' && args[1] === 'inspect') process.exit(1);",
        "if (args[0] === 'build') process.exit(0);",
        "console.log('docker run ok');",
        "process.exit(0);"
      ].join("\n"),
      "utf8"
    );
    await fs.chmod(path.join(tempDir, "bin/docker"), 0o755);
    process.env.PATH = `${path.join(tempDir, "bin")}:${previousPath ?? ""}`;

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles: [{ path: "src/app.py", content: "print('ok')\n" }],
      rules: createRules({
        tools: {
          enabled: true,
          json_validation: false,
          project_type: "python",
          sandbox: {
            mode: "docker",
            image_profile: "auto",
            auto_build: true,
            dockerfile: "Dockerfile.tools"
          },
          commands: {
            lint: { enabled: false },
            typecheck: { enabled: false },
            build: { enabled: false },
            test: { enabled: true }
          }
        }
      })
    });

    const testResult = summary.results.find((entry) => entry.name === "test");
    const log = await fs.readFile(dockerLog, "utf8");
    assert.equal(testResult?.ok, true);
    assert.equal(testResult?.sandboxImage, "ai-coding-system:python");
    assert.match(log, /build\|-t\|ai-coding-system:python\|-f\|.*Dockerfile\.tools/);
    assert.match(log, /run\|--rm\|.*ai-coding-system:python\|pytest/);
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("createDryRunToolExecutionSummary skips command-based checks explicitly", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-dryrun-summary-"));

  try {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "dryrun-summary-test",
          private: true,
          scripts: {
            lint: "echo lint",
            typecheck: "echo typecheck"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const summary = await createDryRunToolExecutionSummary({
      repoRoot: tempDir,
      rules: createRules(),
      reason: "dry-run repo sandbox is incomplete"
    });
    const lintResult = summary.results.find((entry) => entry.name === "lint");
    const typecheckResult = summary.results.find((entry) => entry.name === "typecheck");

    assert.equal(summary.issues.length, 0);
    assert.equal(lintResult?.skipped, true);
    assert.match(lintResult?.summary ?? "", /dry-run repo sandbox is incomplete/);
    assert.equal(typecheckResult?.skipped, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runToolChecks scopes package build scripts for dashboard changes when build is enabled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-tool-package-build-scope-"));
  const changedFiles: GeneratedFile[] = [{ path: "dashboard/src/App.tsx", content: "export const App = () => null;\n" }];

  try {
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "dashboard/scripts"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "workspace-root",
          private: true,
          scripts: {
            build: "node ./scripts/root-build.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "dashboard/package.json"),
      JSON.stringify(
        {
          name: "dashboard",
          private: true,
          scripts: {
            build: "node ./scripts/package-build.js"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(tempDir, "scripts/root-build.js"), "console.log('root build'); process.exit(1);\n", "utf8");
    await fs.writeFile(path.join(tempDir, "dashboard/scripts/package-build.js"), "console.log(process.cwd()); process.exit(0);\n", "utf8");

    const summary = await runToolChecks({
      repoRoot: tempDir,
      changedFiles,
      rules: createRules({
        tools: {
          enabled: true,
          json_validation: true,
          commands: {
            lint: { enabled: false },
            typecheck: { enabled: false },
            build: { enabled: true },
            test: { enabled: false }
          }
        }
      })
    });

    const buildResult = summary.results.find((entry) => entry.name === "build");
    assert.equal(buildResult?.ok, true);
    assert.equal(buildResult?.scope, "package");
    assert.equal(buildResult?.workingDirectory, "dashboard");
    assert.deepEqual(buildResult?.args, ["run", "build"]);
    assert.match(buildResult?.stdout ?? "", /dashboard/);
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
