import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrchestraStoreDescriptor } from "../ai-system/core/orchestra-store.js";

test("resolveOrchestraStoreDescriptor reports file mode truthfully", async () => {
  const previous = process.env.ORCHESTRA_STORE;
  delete process.env.ORCHESTRA_STORE;

  try {
    const descriptor = resolveOrchestraStoreDescriptor();
    assert.equal(descriptor.mode, "file");
    assert.equal(descriptor.implemented, true);
    assert.equal(descriptor.capabilities.durable, false);
    assert.equal(descriptor.capabilities.migrations, false);
    assert.equal(descriptor.capabilities.multiProcess, false);
    assert.equal(descriptor.warning, undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRA_STORE;
    } else {
      process.env.ORCHESTRA_STORE = previous;
    }
  }
});

test("resolveOrchestraStoreDescriptor warns for reserved sqlite and postgres modes", async () => {
  const previous = process.env.ORCHESTRA_STORE;

  try {
    process.env.ORCHESTRA_STORE = "sqlite";
    const sqliteDescriptor = resolveOrchestraStoreDescriptor();
    assert.equal(sqliteDescriptor.mode, "sqlite");
    assert.equal(sqliteDescriptor.implemented, false);
    assert.equal(sqliteDescriptor.capabilities.durable, false);
    assert.match(sqliteDescriptor.warning ?? "", /SQLite store is reserved/);

    process.env.ORCHESTRA_STORE = "postgres";
    const postgresDescriptor = resolveOrchestraStoreDescriptor();
    assert.equal(postgresDescriptor.mode, "postgres");
    assert.equal(postgresDescriptor.implemented, false);
    assert.equal(postgresDescriptor.capabilities.durable, false);
    assert.match(postgresDescriptor.warning ?? "", /Postgres store is reserved/);
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRA_STORE;
    } else {
      process.env.ORCHESTRA_STORE = previous;
    }
  }
});
