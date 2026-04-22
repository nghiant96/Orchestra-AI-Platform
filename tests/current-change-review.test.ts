import test from "node:test";
import assert from "node:assert/strict";
import { parseGitStatusPaths } from "../ai-system/core/current-change-review.js";

test("parseGitStatusPaths extracts modified, renamed, deleted, and untracked paths", () => {
  const output = [
    " M src/changed.ts",
    "A  src/new.ts",
    "R  src/old-name.ts -> src/new-name.ts",
    " D src/deleted.ts",
    "?? src/untracked.ts"
  ].join("\n");

  assert.deepEqual(parseGitStatusPaths(output), [
    "src/changed.ts",
    "src/new.ts",
    "src/new-name.ts",
    "src/deleted.ts",
    "src/untracked.ts"
  ]);
});
