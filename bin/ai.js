#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(currentDir, "../dist/ai-system/cli.js");

if (!fs.existsSync(cliPath)) {
  console.error("[ai] Build output not found. Run `npm run build` first.");
  process.exit(1);
}

const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
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
