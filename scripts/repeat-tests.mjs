#!/usr/bin/env node
/**
 * Run the test suite N times in a row and report which tests are not stable.
 *
 * A single green run proves nothing about a suite that spawns subprocesses and
 * shares the machine with whatever else is running. Use this before trusting
 * "tests pass" — and after touching anything timing- or filesystem-sensitive.
 *
 *   pnpm run test:flake          # 10 runs
 *   pnpm run test:flake -- 3     # 3 runs
 */
import { spawn } from "node:child_process";
import process from "node:process";

const runs = Number(process.argv[2] ?? 10);
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`Expected a positive run count, received: ${process.argv[2]}`);
  process.exit(2);
}

const failuresByRun = new Map();

for (let run = 1; run <= runs; run++) {
  const started = Date.now();
  const { code, stdout } = await runSuite();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (code === 0) {
    console.log(`run ${run}/${runs}: pass (${seconds}s)`);
    continue;
  }

  const failed = parseFailedTests(stdout);
  failuresByRun.set(run, failed);
  console.log(`run ${run}/${runs}: FAIL (${seconds}s) — ${failed.length ? failed.join(", ") : "see output above"}`);
}

if (failuresByRun.size === 0) {
  console.log(`\n${runs}/${runs} runs green.`);
  process.exit(0);
}

console.log(`\n${failuresByRun.size}/${runs} runs failed.`);
const tally = new Map();
for (const failed of failuresByRun.values()) {
  for (const name of failed) {
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
}
for (const [name, count] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}/${runs} runs: ${name}`);
}
process.exit(1);

function runSuite() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--test", "--test-timeout=180000", "tests/**/*.test.ts"],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] }
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

/** Pull test names out of the runner's trailing "failing tests:" block. */
function parseFailedTests(stdout) {
  const marker = stdout.lastIndexOf("failing tests:");
  if (marker === -1) return [];
  const names = new Set();
  for (const line of stdout.slice(marker).split("\n")) {
    const match = /^✖ (.+?) \([\d.]+ms\)$/.exec(line.trim());
    if (match) names.add(match[1]);
  }
  return [...names];
}
