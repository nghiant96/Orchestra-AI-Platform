import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DependencyGraph } from "../ai-system/core/dependency-graph.js";

async function createTempRepo(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(root, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, "utf8");
  }
  return root;
}

test("DependencyGraph correctly identifies internal imports", async () => {
  const repo = await createTempRepo({
    "index.ts": 'import { a } from "./src/a"; import { b } from "./src/b";',
    "src/a.ts": 'import { c } from "./c";',
    "src/b.ts": 'export const b = 1;',
    "src/c.ts": 'export const c = 1;'
  });

  try {
    const graph = new DependencyGraph(repo);
    await graph.buildGraph(["index.ts"]);

    const node = graph.nodes.get("index.ts");
    assert.ok(node);
    assert.deepEqual(node.imports.sort(), ["src/a.ts", "src/b.ts"]);

    const related = await graph.getRelatedFiles(["index.ts"], 1);
    assert.ok(related.includes("src/a.ts"));
    assert.ok(related.includes("src/b.ts"));
    assert.ok(!related.includes("src/c.ts")); // depth 1 should not include c

    const relatedDepth2 = await graph.getRelatedFiles(["index.ts"], 2);
    assert.ok(relatedDepth2.includes("src/c.ts"));
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test("DependencyGraph handles missing files gracefully", async () => {
  const repo = await createTempRepo({
    "main.ts": 'import { missing } from "./missing";'
  });

  try {
    const graph = new DependencyGraph(repo);
    await graph.buildGraph(["main.ts"]);
    assert.equal(graph.nodes.get("main.ts")?.imports.length, 0);
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});
