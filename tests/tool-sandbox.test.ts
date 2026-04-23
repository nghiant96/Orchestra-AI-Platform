import test from "node:test";
import assert from "node:assert/strict";
import { resolveToolSandbox } from "../ai-system/core/tool-sandbox.js";

test("resolveToolSandbox correctly identifies docker mode", () => {
  const config = { mode: "docker" as const, image: "custom-image" };
  const resolved = resolveToolSandbox(config);
  assert.equal(resolved.mode, "docker");
  assert.equal(resolved.image, "custom-image");
});

test("resolveToolSandbox preserves environment variables in docker mode", () => {
  process.env.TEST_VAR = "hello";
  const config = { mode: "docker" as const, include_env: ["TEST_VAR"] };
  const resolved = resolveToolSandbox(config);
  assert.equal(resolved.env.TEST_VAR, "hello");
  delete process.env.TEST_VAR;
});

test("resolveToolSandbox defaults to inherit", () => {
  const resolved = resolveToolSandbox({});
  assert.equal(resolved.mode, "inherit");
});
