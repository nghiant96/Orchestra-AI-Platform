#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const pathspecs = [":(glob)**/*.js", "tsconfig.tsbuildinfo"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}${stderr}`);
  }
  return result.stdout ?? "";
}

function snapshotGeneratedState() {
  return run("git", ["status", "--porcelain", "--untracked-files=all", "--", ...pathspecs]);
}

const before = snapshotGeneratedState();
run("tsc", [], { stdio: "inherit" });
const after = snapshotGeneratedState();

if (before !== after) {
  console.error("Generated JS mirrors changed after running tsc.");
  console.error("Run `tsc`, review the generated .js/tsconfig.tsbuildinfo changes, and include them with the TypeScript changes.");
  process.exit(1);
}
