# Task Todo

Use this file for non-trivial work that benefits from an explicit execution plan.

## Active Task

Task: Improve the AI Coding System runtime by tightening TypeScript safety, hardening command timeout handling, and adding regression tests.

- [x] Define the current task
- [x] Read project guidance and existing lessons
- [x] Enable stricter TypeScript settings and fix the resulting compiler errors
- [x] Add timeout escalation so stuck child processes are force-killed after a grace period
- [x] Add project-level tests for JSON extraction, schema validation, and env loading behavior
- [x] Run verification and record the final result

## Review

- Result: `strict` is now enabled in `tsconfig.json`, the codebase passes `pnpm exec tsc --noEmit`, command execution escalates from `SIGTERM` to `SIGKILL` after a configurable grace period, and new project-level tests cover env parsing/loading, JSON extraction, schema validation, and timeout cleanup.
- Verification:
  - `pnpm exec tsc --noEmit`
  - `pnpm test`
  - `pnpm run ai:help`
  - `node --import tsx ./bin/ai.js --help`
- Notes: Added `test` and `typecheck` scripts, plus a pure `parseEnvFileContent` helper to make env-loading behavior testable without depending on Node runtime internals.
