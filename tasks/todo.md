# Task Todo

Use this file for non-trivial work that benefits from an explicit execution plan.

## Active Task

Task: Add `ai explain-routing` so provider routing can be understood without reading raw artifacts or source code internals.

- [x] Review the current routing data sources and CLI surfaces
- [x] Add `ai explain-routing` to the CLI
- [x] Print planning and implementation routing summaries clearly
- [x] Support both task-based explanation and latest-run fallback
- [x] Verify with tests and CLI checks

## Review

- Result: Completed.
- Verification:
  - Passed `pnpm exec tsc --noEmit`
  - Passed `pnpm test`
  - Passed `node --import tsx ./bin/ai.js explain-routing "Update README wording and docs text"`
- Notes: `ai explain-routing` now provides an operator-facing explanation of provider routing. With a task, it explains the current planning-stage routing decision from the active config. Without a task, it falls back to the latest artifact-backed run and prints the planning and implementation routing decisions stored there.
