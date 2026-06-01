import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkerStore, resolveWorkerStoreDir } from "../ai-system/workers/worker-store.js";
import type { Worker } from "../ai-system/workers/worker-types.js";

describe("WorkerStore", () => {
  let tmpDir: string;
  let store: WorkerStore;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-store-test-"));
    store = new WorkerStore(resolveWorkerStoreDir(tmpDir));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("creates a worker and loads it", async () => {
    const worker = await store.create({
      name: "test-worker",
      version: "1.0.0",
      os: "darwin",
      arch: "arm64",
      labels: ["macbook", "ios"],
      capabilities: { xcode: true, node: true },
      workspaceRoots: ["/Users/test"],
      status: "online",
      lastHeartbeatAt: new Date().toISOString()
    });

    assert.ok(worker.id.startsWith("worker-"), "ID should have worker- prefix");
    assert.equal(worker.name, "test-worker");
    assert.equal(worker.os, "darwin");
    assert.equal(worker.status, "online");
    assert.ok(worker.sessionToken, "Should have session token");
    assert.ok(worker.createdAt, "Should have createdAt");

    const loaded = await store.load(worker.id);
    assert.ok(loaded);
    assert.equal(loaded.id, worker.id);
    assert.equal(loaded.name, "test-worker");
    assert.equal(loaded.sessionToken, worker.sessionToken);
    assert.equal(loaded.status, "online");
  });

  test("load returns null for unknown id", async () => {
    const result = await store.load("worker-nonexistent");
    assert.equal(result, null);
  });

  test("load returns null for invalid id format", async () => {
    const result = await store.load("../etc/passwd");
    assert.equal(result, null);
  });

  test("save updates a worker", async () => {
    const worker = await store.create({
      id: "worker-save-test",
      name: "save-test",
      version: "1.0.0",
      os: "linux",
      arch: "x64",
      labels: [],
      capabilities: {},
      workspaceRoots: [],
      status: "online",
      lastHeartbeatAt: new Date().toISOString(),
      sessionToken: "test-token"
    });

    const updated: Worker = { ...worker, status: "idle", freeDiskGb: 100 };
    await store.save(updated);

    const loaded = await store.load(worker.id);
    assert.ok(loaded);
    assert.equal(loaded.status, "idle");
    assert.equal(loaded.freeDiskGb, 100);
  });

  test("list returns all workers sorted by lastHeartbeatAt", async () => {
    const w1 = await store.create({
      name: "worker-a",
      version: "1.0.0",
      os: "darwin",
      arch: "arm64",
      labels: [],
      capabilities: {},
      workspaceRoots: [],
      status: "online",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z"
    });
    const w2 = await store.create({
      name: "worker-b",
      version: "1.0.0",
      os: "linux",
      arch: "x64",
      labels: [],
      capabilities: {},
      workspaceRoots: [],
      status: "idle",
      lastHeartbeatAt: "2026-06-01T00:00:00.000Z"
    });

    const workers = await store.list();
    assert.ok(workers.length >= 2);

    const ids = workers.map((w) => w.id);
    assert.ok(ids.includes(w1.id));
    assert.ok(ids.includes(w2.id));

    assert.ok(new Date(workers[0]!.lastHeartbeatAt).getTime() >= new Date(workers[1]!.lastHeartbeatAt).getTime());
  });

  test("delete removes a worker", async () => {
    const worker = await store.create({
      name: "delete-test",
      version: "1.0.0",
      os: "darwin",
      arch: "arm64",
      labels: [],
      capabilities: {},
      workspaceRoots: [],
      status: "online",
      lastHeartbeatAt: new Date().toISOString()
    });

    const deleted = await store.delete(worker.id);
    assert.equal(deleted, true);

    const loaded = await store.load(worker.id);
    assert.equal(loaded, null);
  });

  test("delete returns false for invalid id", async () => {
    const result = await store.delete("../malicious");
    assert.equal(result, false);
  });

  test("save rejects invalid ids", async () => {
    await assert.rejects(
      store.save({
        id: "../malicious",
        name: "bad",
        version: "1.0.0",
        os: "darwin",
        arch: "arm64",
        labels: [],
        capabilities: {},
        workspaceRoots: [],
        status: "online",
        lastHeartbeatAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      }),
      /Invalid worker id/
    );
  });

  test("generateId produces unique ids", () => {
    const id1 = WorkerStore.generateId("test");
    const id2 = WorkerStore.generateId("test");
    assert.ok(id1.startsWith("worker-"));
    assert.notEqual(id1, id2);
  });

  test("generateSessionToken produces unique tokens", () => {
    const t1 = WorkerStore.generateSessionToken();
    const t2 = WorkerStore.generateSessionToken();
    assert.ok(t1.startsWith("ws_"));
    assert.notEqual(t1, t2);
  });
});
