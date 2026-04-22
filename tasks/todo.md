# Task Todo

Use this file for non-trivial work that benefits from an explicit execution plan.

## Active Task

Task: Add machine-readable run inspection plus explicit workflow modes so the CLI is easier to automate and use day to day.

- [x] Review current CLI parsing and task execution flow for workflow aliases and JSON output
- [x] Add `--json` output for run inspection commands
- [x] Add `ai implement`, `ai review`, and `ai fix` workflow modes with sensible defaults
- [x] Verify with tests, docs, and CLI checks

## Review

- Result: Completed.
- Verification:
  - Passed `pnpm exec tsc --noEmit`
  - Passed `pnpm test`
  - Passed `node --import tsx ./bin/ai.js --help`
  - Passed `node --import tsx ./bin/ai.js runs list`
  - Passed seeded CLI check for `node --import tsx ./bin/ai.js runs show <run> --json`
- Notes: Operators can now browse recent runs directly from the CLI, export run summaries as JSON for automation/reporting, and use explicit `implement/review/fix` workflows instead of remembering combinations of dry-run and checkpoint flags.
