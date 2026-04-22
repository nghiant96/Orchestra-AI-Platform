# Task Todo

Use this file for non-trivial work that benefits from an explicit execution plan.

## Active Task

Task: Add context-aware and plan-aware provider routing so the system can choose planner/reviewer/generator/fixer more intelligently.

- [x] Define the current task
- [x] Read project guidance and existing lessons
- [x] Create a dedicated provider-router module with scoring signals
- [x] Apply routing once before planning and reroute again after plan creation
- [x] Persist routing decisions into artifacts/timeline for debugging
- [x] Add tests for plan-aware rerouting and override precedence
- [x] Run full verification and record the result

## Review

- Result: Completed.
- Verification:
  - Passed `pnpm exec tsc --noEmit`
  - Passed `pnpm test`
  - Passed `pnpm run ai:help`
- Notes: Routing is now decided twice: once before planning from task/repo signals, and again after planning from the actual read/write targets. Both decisions are persisted into `00-routing/*.json` and the artifact timeline for debugging.
