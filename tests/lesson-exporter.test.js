import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateAndPersistWorkItemLesson, generateWorkItemLesson } from "../ai-system/work/lesson-exporter.js";
describe("work item lesson exporter", () => {
    test("generates redacted success and failure lessons", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lesson-exporter-"));
        const workItem = makeWorkItem("done");
        const jobs = [{
                version: 1,
                jobId: "job-1",
                status: "completed",
                task: "do work",
                cwd: tmp,
                dryRun: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                artifactPath: path.join(tmp, ".artifacts", "run-1"),
                resultSummary: "Changed output",
                error: null,
                diffSummaries: [{ path: "src/app.ts", beforeLineCount: 1, afterLineCount: 2, addedLines: 1, removedLines: 0, changedLineEstimate: 1 }],
                latestToolResults: [{
                        name: "test",
                        kind: "command",
                        ok: true,
                        skipped: false,
                        issueCount: 0,
                        durationMs: 10,
                        command: "OPENAI_API_KEY=sk-abc123456789012345678901 test",
                        summary: "passed"
                    }]
            }];
        try {
            const lesson = generateWorkItemLesson(workItem, jobs);
            assert.equal(lesson.lessonType, "success");
            assert.deepEqual(lesson.changedFiles, ["src/app.ts"]);
            const persisted = await generateAndPersistWorkItemLesson(tmp, { artifacts: { data_dir: ".artifacts" } }, workItem, jobs);
            const raw = await fs.readFile(persisted.lessonPath, "utf8");
            assert.match(raw, /sk-REDACTED/);
            assert.doesNotMatch(raw, /sk-abc123456789012345678901/);
            const failed = generateWorkItemLesson({ ...workItem, status: "failed" }, [{ ...jobs[0], status: "failed", error: "Typecheck failed" }]);
            assert.equal(failed.lessonType, "failure");
            assert.equal(failed.failure?.message, "Typecheck failed");
        }
        finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    });
});
function makeWorkItem(status) {
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        id: "work-2026-01-01-test",
        projectId: "test",
        title: "Export lesson",
        description: "Make sure lessons are reusable",
        source: "manual",
        type: "feature",
        status,
        risk: "low",
        expectedOutput: "patch",
        createdBy: "test",
        createdAt: now,
        updatedAt: now,
        linkedRuns: ["job-1"],
        checklist: []
    };
}
