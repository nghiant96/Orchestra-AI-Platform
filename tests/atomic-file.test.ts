import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "../ai-system/utils/atomic-file.js";
import { removeTempDir } from "./test-utils.js";

describe("writeFileAtomic", () => {
  test("concurrent writes to one path all settle and leave a complete document", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-file-"));
    const target = path.join(tmpDir, "record.json");

    try {
      // Fired without awaiting in between, these land in the same millisecond.
      // A clock-derived temp name collides here: writers share one temp file,
      // the first rename consumes it, and the rest fail with ENOENT.
      const payloads = Array.from({ length: 50 }, (_, index) => JSON.stringify({ revision: index }));
      const results = await Promise.allSettled(payloads.map((payload) => writeFileAtomic(target, payload)));

      const rejected = results.filter((result) => result.status === "rejected");
      assert.deepEqual(rejected, [], `all writes should succeed, got ${rejected.length} failures`);

      // Last writer wins, but the winner must be one whole payload — never a
      // blend of two, and never truncated.
      const written = await fs.readFile(target, "utf8");
      assert.ok(payloads.includes(written), `expected one intact payload, got: ${written}`);

      const leftovers = (await fs.readdir(tmpDir)).filter((entry) => entry.includes(".tmp."));
      assert.deepEqual(leftovers, [], "temp files should not outlive the write");
    } finally {
      await removeTempDir(tmpDir);
    }
  });

  test("a failed write removes its own temp file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-file-fail-"));

    try {
      // A directory cannot be replaced by a rename of a regular file.
      const target = path.join(tmpDir, "occupied");
      await fs.mkdir(target);

      await assert.rejects(() => writeFileAtomic(target, "payload"));

      const leftovers = (await fs.readdir(tmpDir)).filter((entry) => entry.includes(".tmp."));
      assert.deepEqual(leftovers, [], "a failed write should not leave a temp file behind");
    } finally {
      await removeTempDir(tmpDir);
    }
  });
});
