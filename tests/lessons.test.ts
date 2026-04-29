import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendProjectLesson,
  formatLessonsForPrompt,
  proposeLessonsFromRuns,
  readProjectLessons
} from "../ai-system/core/lessons.js";

test("project lessons are stored, read, and formatted for planning", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-lessons-"));
  try {
    await appendProjectLesson(repoRoot, {
      title: "Preserve queue IDs",
      body: "Do not pass custom queue IDs unless the queue API supports them."
    });

    const lessons = await readProjectLessons(repoRoot);
    assert.equal(lessons[0]?.title, "Preserve queue IDs");
    assert.match(formatLessonsForPrompt(lessons), /Project lessons to respect/);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("lesson proposals are derived from repeated failure classes", () => {
  const proposals = proposeLessonsFromRuns([
    failedRun("tool_execution_failed"),
    failedRun("tool_execution_failed"),
    failedRun("provider_timeout")
  ] as any);

  assert.equal(proposals.length, 1);
  assert.match(proposals[0]?.title ?? "", /tool execution failed/);
});

function failedRun(failureClass: string) {
  return {
    runState: {
      status: "failed",
      execution: { failure: { class: failureClass } }
    }
  };
}
