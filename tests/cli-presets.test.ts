import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { applyProviderPreset, setAllRoleProviders } from "../ai-system/cli/presets.js";

describe("CLI Presets", () => {
  beforeEach(() => {
    delete process.env.AI_SYSTEM_PROVIDER;
    delete process.env.AI_SYSTEM_PLANNER_PROVIDER;
    delete process.env.AI_SYSTEM_REVIEWER_PROVIDER;
    delete process.env.AI_SYSTEM_GENERATOR_PROVIDER;
    delete process.env.AI_SYSTEM_FIXER_PROVIDER;
  });

  it("applyProviderPreset handles 9router", () => {
    applyProviderPreset("9router");
    assert.equal(process.env.AI_SYSTEM_PROVIDER, "9router");
  });

  it("applyProviderPreset handles claude-cli", () => {
    applyProviderPreset("claude-cli");
    assert.equal(process.env.AI_SYSTEM_PROVIDER, "claude-cli");
  });

  it("applyProviderPreset ignores null or default", () => {
    applyProviderPreset("default");
    assert.equal(process.env.AI_SYSTEM_PROVIDER, undefined);
  });

  it("setAllRoleProviders sets all specific roles", () => {
    setAllRoleProviders("test-provider");
    assert.equal(process.env.AI_SYSTEM_PLANNER_PROVIDER, "test-provider");
    assert.equal(process.env.AI_SYSTEM_REVIEWER_PROVIDER, "test-provider");
    assert.equal(process.env.AI_SYSTEM_GENERATOR_PROVIDER, "test-provider");
    assert.equal(process.env.AI_SYSTEM_FIXER_PROVIDER, "test-provider");
  });
});
