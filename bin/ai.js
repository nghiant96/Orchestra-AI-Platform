#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(currentDir, "../ai-system/cli.ts");

const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

child.on("error", (error) => {
  console.error(`[ai] Failed to start CLI: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
