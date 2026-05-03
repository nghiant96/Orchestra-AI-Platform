import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAiSystemServer } from "../ai-system/server-app.js";
import { listen, closeServer, silentLogger, requestJson } from "./test-utils.js";

// Phase W0 workspace baseline smoke tests.
// These tests verify that the existing server/CLI behavior is unchanged
// after workspace documentation and glossary files are added.

test("Phase W0 — server jobs API remains functional", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-w0-jobs-"));
    const server = createAiSystemServer({
        defaultCwd: repoRoot,
        logger: silentLogger(),
        runner: async () => {
            return {
                version: 1,
                ok: true,
                status: "completed" as const,
                dryRun: true,
                repoRoot,
                configPath: null,
                plan: { prompt: "baseline", readFiles: [], writeTargets: [], notes: [] },
                result: { summary: "ok", files: [] },
                iterations: [],
                issueCounts: {},
                skippedContextFiles: [],
                finalIssues: [],
                providers: { planner: "test", reviewer: "test", generator: "test", fixer: "test" },
                memory: { backend: "test", planningMatches: 0, implementationMatches: 0, stored: false },
                artifacts: {
                    enabled: true,
                    ok: true,
                    runPath: path.join(repoRoot, ".ai-system-artifacts", "mock-run"),
                    latestIterationPath: null,
                    stepPaths: {},
                    latestFiles: [],
                },
                wroteFiles: false,
            };
        },
    });

    try {
        const baseUrl = await listen(server);

        // /jobs POST
        const created = await requestJson(baseUrl, "POST", "/jobs", { task: "w0 smoke task", dryRun: true }, 202);
        assert.equal(created.status, "queued");
        assert.equal(typeof created.jobId, "string");

        // /jobs GET
        const listed = await requestJson(baseUrl, "GET", "/jobs");
        assert.equal(Array.isArray(listed.jobs), true);

        // /stats
        const stats = await requestJson(baseUrl, "GET", "/stats");
        assert.equal(typeof stats, "object");
        assert.equal(stats.version, 1);
        assert.equal(typeof stats.totalRuns, "number");
        assert.equal(typeof stats.totalProjectCost, "number");

        // /audit
        const audit = await requestJson(baseUrl, "GET", "/audit");
        assert.equal(Array.isArray(audit.events), true);
    } finally {
        await closeServer(server);
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});
test("Phase W0 — workspace artifacts can coexist with run artifacts", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-w0-artifacts-"));
    const artifactsDir = path.join(repoRoot, ".ai-system-artifacts");

    try {
        // Simulate an existing run artifact
        const runDir = path.join(artifactsDir, "run-2026-05-02T00-00-00Z-test");
        await fs.mkdir(runDir, { recursive: true });
        await fs.writeFile(path.join(runDir, "run-state.json"), JSON.stringify({ status: "completed", task: "old task" }));

        // Simulate a workspace work-items directory (future layout)
        const workItemsDir = path.join(artifactsDir, "work-items");
        await fs.mkdir(workItemsDir, { recursive: true });

        const workItemDir = path.join(workItemsDir, "work_test001");
        await fs.mkdir(workItemDir, { recursive: true });
        await fs.writeFile(
            path.join(workItemDir, "work-item.json"),
            JSON.stringify({ id: "work_test001", title: "Test work item", status: "created" })
        );

        // Both should coexist without issues
        const runExists = await fs.stat(path.join(runDir, "run-state.json")).then(() => true).catch(() => false);
        const workItemExists = await fs.stat(path.join(workItemDir, "work-item.json")).then(() => true).catch(() => false);

        assert.equal(runExists, true, "Existing run artifacts must remain readable");
        assert.equal(workItemExists, true, "New work-item artifacts must be creatable alongside runs");

        // Read old run artifact — it should still load
        const runStateRaw = await fs.readFile(path.join(runDir, "run-state.json"), "utf-8");
        const runState = JSON.parse(runStateRaw);
        assert.equal(runState.status, "completed");
        assert.equal(runState.task, "old task");
    } finally {
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});

test("Phase W0 — docs/WORKSPACE.md exists and contains key domain terms", async () => {
    const workspaceDocPath = path.resolve(
        (typeof import.meta !== "undefined" && import.meta.dirname) ? import.meta.dirname : __dirname,
        "..",
        "docs",
        "WORKSPACE.md"
    );

    const content = await fs.readFile(workspaceDocPath, "utf-8");
    assert.ok(content.length > 500, "WORKSPACE.md must have substantive content");

    const requiredTerms = [
        "Work Item",
        "Assessment",
        "Task Graph",
        "Checklist",
        "Evidence",
        "Run",
        "Job",
        "Project",
        "Workspace",
        "Migration Rule",
        "Phase W0",
    ];

    for (const term of requiredTerms) {
        assert.ok(
            content.includes(term),
            `WORKSPACE.md must define the domain term: "${term}"`
        );
    }

    // Verify acceptance criteria section is present and trackable
    assert.ok(content.includes("Phase W0 Acceptance Criteria"));
    assert.ok(content.includes("Old runs remain readable"));
    assert.ok(content.includes("do NOT require a Work Item"));
});
