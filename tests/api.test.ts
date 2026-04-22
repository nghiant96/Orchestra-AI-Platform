import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadEnvironment, parseEnvFileContent, runCommand } from "../ai-system/utils/api.js";

test("parseEnvFileContent supports inline comments and multiline quoted values", () => {
  const parsed = parseEnvFileContent([
    "PLAIN=value # comment",
    'QUOTED="hello world"',
    "MULTILINE='line one",
    "line two'",
    "export EXPORTED=kept"
  ].join("\n"));

  assert.deepEqual(parsed, {
    PLAIN: "value",
    QUOTED: "hello world",
    MULTILINE: "line one\nline two",
    EXPORTED: "kept"
  });
});

test("loadEnvironment loads repo-local .env without overriding existing variables", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-env-"));
  const existingKey = "AI_SYSTEM_TEST_EXISTING";
  const newKey = "AI_SYSTEM_TEST_NEW";
  const previousExisting = process.env[existingKey];
  const previousNew = process.env[newKey];

  try {
    await fs.writeFile(path.join(tempDir, ".env"), `${existingKey}=from-file\n${newKey}=loaded\n`, "utf8");
    process.env[existingKey] = "already-set";
    delete process.env[newKey];

    await loadEnvironment(tempDir);

    assert.equal(process.env[existingKey], "already-set");
    assert.equal(process.env[newKey], "loaded");
  } finally {
    if (typeof previousExisting === "undefined") {
      delete process.env[existingKey];
    } else {
      process.env[existingKey] = previousExisting;
    }

    if (typeof previousNew === "undefined") {
      delete process.env[newKey];
    } else {
      process.env[newKey] = previousNew;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runCommand force-kills hung child processes after the grace period", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-run-command-"));
  const pidPath = path.join(tempDir, "child.pid");
  const script = [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);"
  ].join(" ");

  try {
    await assert.rejects(
      runCommand({
        command: process.execPath,
        args: ["-e", script],
        cwd: tempDir,
        timeoutMs: 150,
        killGraceMs: 50
      }),
      /timed out/
    );

    const pid = Number(await fs.readFile(pidPath, "utf8"));
    await waitFor(() => isProcessGone(pid), 1500);
    assert.equal(isProcessGone(pid), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const normalized = error as NodeJS.ErrnoException;
    if (normalized.code === "ESRCH") {
      return true;
    }
    throw error;
  }
}
