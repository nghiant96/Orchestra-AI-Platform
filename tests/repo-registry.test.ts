import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RepoRegistryStore, resolveRegisteredRepoPath } from "../ai-system/repos/repo-registry.js";

describe("repo registry", () => {
  test("registers and resolves repos inside allowed roots only", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-registry-root-"));
    const repo = await fs.mkdtemp(path.join(root, "repo-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "repo-registry-outside-"));
    const store = new RepoRegistryStore(root);

    try {
      const entry = await store.register({ repoId: "sample-repo", localPath: repo }, [root]);
      assert.equal(entry.repoId, "sample-repo");
      assert.equal(entry.localPath, await fs.realpath(repo));

      const resolved = await resolveRegisteredRepoPath(root, "sample-repo", [root]);
      assert.equal(resolved?.localPath, await fs.realpath(repo));

      await assert.rejects(
        () => store.register({ repoId: "outside", localPath: outside }, [root]),
        /outside AI_SYSTEM_ALLOWED_WORKDIRS/
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
