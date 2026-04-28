import test from "node:test";
import assert from "node:assert/strict";
import { resolveSandboxImage, resolveToolSandbox } from "../ai-system/core/tool-sandbox.js";

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

test("resolveSandboxImage gives explicit image precedence", () => {
  const sandbox = resolveToolSandbox({
    mode: "docker",
    image: "custom:latest",
    image_profile: "python",
    dockerfile: "Dockerfile.python"
  });
  const resolved = resolveSandboxImage(sandbox, {
    repoRoot: "/repo",
    projectType: "go"
  });
  assert.equal(resolved.image, "custom:latest");
  assert.equal(resolved.imageProfile, "python");
  assert.equal(resolved.dockerfile, "/repo/Dockerfile.python");
});

test("resolveSandboxImage maps auto profile from project type", () => {
  const sandbox = resolveToolSandbox({
    mode: "docker",
    image_profile: "auto"
  });
  assert.equal(resolveSandboxImage(sandbox, { repoRoot: "/repo", projectType: "python" }).image, "ai-coding-system:python");
  assert.equal(resolveSandboxImage(sandbox, { repoRoot: "/repo", projectType: "go" }).image, "ai-coding-system:go");
  assert.equal(resolveSandboxImage(sandbox, { repoRoot: "/repo", projectType: "rust" }).image, "ai-coding-system:rust");
});
