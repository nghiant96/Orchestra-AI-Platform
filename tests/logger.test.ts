import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseDashboard } from "../ai-system/utils/logger.js";

test("shouldUseDashboard disables TUI for json output", () => {
  assert.equal(
    shouldUseDashboard({
      enableDashboard: true,
      outputJson: true,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      term: "xterm-256color",
      disabled: false
    }),
    false
  );
});

test("shouldUseDashboard disables TUI when no TTY is available", () => {
  assert.equal(
    shouldUseDashboard({
      enableDashboard: true,
      outputJson: false,
      stdinIsTTY: true,
      stdoutIsTTY: false,
      term: "xterm-256color",
      disabled: false
    }),
    false
  );
});

test("shouldUseDashboard enables TUI for interactive terminals", () => {
  assert.equal(
    shouldUseDashboard({
      enableDashboard: true,
      outputJson: false,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      term: "xterm-256color",
      disabled: false
    }),
    true
  );
});
