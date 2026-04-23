import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Orchestrator } from "../ai-system/core/orchestrator.js";
import { createLogger } from "../ai-system/utils/logger.js";

describe("Orchestrator Integration", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("Orchestrator handles missing config file gracefully", async () => {
    mock.method(fs, "realpath", async (p: any) => String(p));
    mock.method(fs, "access", async () => {});

    const logger = createLogger({ verbose: false });
    const orchestrator = new Orchestrator({ repoRoot: "/mock", logger, configPath: "missing.json" });

    mock.method(fs, "readFile", async () => {
      throw new Error("ENOENT");
    });

    try {
      await orchestrator.run("test task", {
        dryRun: true
      });
      assert.fail("Should have thrown ENOENT");
    } catch (err: any) {
      assert.ok(err.message.includes("ENOENT"));
    }
  });
});
