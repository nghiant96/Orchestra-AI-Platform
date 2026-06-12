import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrchestraStoreDescriptor } from "../ai-system/core/orchestra-store.js";

test("resolveOrchestraStoreDescriptor reports file mode truthfully", async () => {
  const previous = process.env.ORCHESTRA_STORE;
  const previousServerMode = process.env.AI_SYSTEM_SERVER_MODE;
  delete process.env.ORCHESTRA_STORE;
  delete process.env.AI_SYSTEM_SERVER_MODE;

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
    if (previousServerMode === undefined) {
      delete process.env.AI_SYSTEM_SERVER_MODE;
    } else {
      process.env.AI_SYSTEM_SERVER_MODE = previousServerMode;
    }
  }
});

test("resolveOrchestraStoreDescriptor marks sqlite and postgres implemented", async () => {
  const previous = process.env.ORCHESTRA_STORE;
  const previousServerMode = process.env.AI_SYSTEM_SERVER_MODE;

  try {
    process.env.ORCHESTRA_STORE = "sqlite";
    const sqliteDescriptor = resolveOrchestraStoreDescriptor();
    assert.equal(sqliteDescriptor.mode, "sqlite");
    assert.equal(sqliteDescriptor.implemented, true);
    assert.equal(sqliteDescriptor.capabilities.durable, true);
    assert.equal(sqliteDescriptor.capabilities.multiProcess, true);
    assert.equal(sqliteDescriptor.warning, undefined);

    process.env.ORCHESTRA_STORE = "postgres";
    const postgresDescriptor = resolveOrchestraStoreDescriptor();
    assert.equal(postgresDescriptor.mode, "postgres");
    assert.equal(postgresDescriptor.implemented, true);
    assert.equal(postgresDescriptor.capabilities.durable, true);
    assert.equal(postgresDescriptor.capabilities.migrations, true);
    assert.equal(postgresDescriptor.capabilities.multiProcess, true);

    delete process.env.ORCHESTRA_STORE;
    process.env.AI_SYSTEM_SERVER_MODE = "true";
    const serverDefaultDescriptor = resolveOrchestraStoreDescriptor();
    assert.equal(serverDefaultDescriptor.mode, "sqlite");
    assert.equal(serverDefaultDescriptor.implemented, true);
    assert.equal(serverDefaultDescriptor.capabilities.durable, true);
    assert.equal(serverDefaultDescriptor.capabilities.multiProcess, true);
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRA_STORE;
    } else {
      process.env.ORCHESTRA_STORE = previous;
    }
    if (previousServerMode === undefined) {
      delete process.env.AI_SYSTEM_SERVER_MODE;
    } else {
      process.env.AI_SYSTEM_SERVER_MODE = previousServerMode;
    }
  }
});
