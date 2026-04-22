# Task Todo

Use this file for non-trivial work that benefits from an explicit execution plan.

## Active Task

Task: Add artifact apply support and upgrade `ai review` so the CLI handles saved candidates plus current working tree review.

- [x] Review artifact candidate format and reviewer flow for current working tree support
- [x] Add `ai apply --from-artifact <target>` with safe artifact loading and atomic writes
- [x] Upgrade `ai review` so it reviews current working tree changes when they exist
- [x] Verify with tests, docs, and CLI checks

## Review

- Result: Completed.
- Verification:
  - Passed `pnpm exec tsc --noEmit`
  - Passed `pnpm test`
  - Passed `node --import tsx ./bin/ai.js --help`
  - Passed seeded CLI check for `ai apply --from-artifact <iteration-path>`
- Notes: `ai apply --from-artifact` now applies saved candidate files atomically, and `ai review` now reviews the current working tree when local changes exist. An end-to-end `ai review` check against a temporary repo stalled inside the live reviewer provider, so the current verification for that path is covered by unit/integration tests plus helper-level CLI validation rather than a fully completed provider round-trip.
- Verification:
  - Passed `pnpm exec tsc --noEmit`
  - Passed `pnpm test`
  - Passed `node --import tsx ./bin/ai.js --help`
  - Passed `node --import tsx ./bin/ai.js runs list`
  - Passed seeded CLI check for `node --import tsx ./bin/ai.js runs show <run> --json`
- Notes: Operators can now browse recent runs directly from the CLI, export run summaries as JSON for automation/reporting, and use explicit `implement/review/fix` workflows instead of remembering combinations of dry-run and checkpoint flags.
