import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProvider } from "../ai-system/providers/registry.js";
import { silentLogger } from "./test-utils.js";
test("provider failover keeps startup and permission errors on the original provider", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-provider-failover-"));
    const rules = {
        providers: {
            planner: { type: "codex-cli", command: "false" },
            reviewer: { type: "claude-cli", command: "true" },
            generator: { type: "codex-cli", command: "true" },
            fixer: { type: "codex-cli", command: "true" }
        }
    };
    try {
        const provider = createProvider("planner", rules, silentLogger());
        await assert.rejects(provider.runJson({
            cwd: repoRoot,
            label: "planner output",
            systemPrompt: "",
            prompt: "hello",
            schema: { type: "object" },
            timeoutMs: 1000,
            retries: 0,
            baseDelayMs: 0
        }), (error) => {
            const message = String(error.message || error);
            assert.match(message, /Command failed: false/);
            assert.doesNotMatch(message, /claude/i);
            return true;
        });
    }
    finally {
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
});
