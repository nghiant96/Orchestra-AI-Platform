- [x] Add `ai fix-checks` to run current repo checks, convert failing output into a structured repair task, and execute the existing fix loop
- [x] Add tests for failing-check task construction and green-check short-circuit behavior

Review/result:
- `ai fix-checks` now runs the configured repo checks, extracts file hints from failing output when possible, and reuses the existing orchestration flow instead of creating a separate fix engine.
- When checks are already green, the command exits cleanly without running the generator/reviewer loop.
- Verified with `pnpm exec tsc --noEmit`, `pnpm test`, and `node --import tsx --test tests/fix-checks.test.ts tests/workflow-modes.test.ts`.

- [x] Replace regex-based symbol chunking in ai-system/core/vector-index.ts with TypeScript AST-based symbol extraction
- [x] Add optional TUI dashboard for CLI live visibility using blessed, with safe fallback to plain logger
- [x] Add/update tests for AST chunking edge cases and TUI-safe behavior, then verify with typecheck and targeted/full tests

Review/result:
- AST chunking now uses the TypeScript compiler API for TS/JS-family files, which removes regex-based false positives and keeps semantic chunks aligned to real declarations.
- CLI task and review flows now use an optional `blessed` dashboard on real TTYs, with automatic fallback to plain logging for `--json`, non-TTY, and disabled-dashboard cases.
- Verified with `pnpm exec tsc --noEmit`, `pnpm test`, `node --import tsx --test tests/vector-index.test.ts tests/logger.test.ts`, `node --import tsx ./bin/ai.js --help`, and a TTY smoke for the dashboard path.

- [x] Add stage-targeted retry/resume semantics on top of the execution state machine
- [x] Persist retry hints for failed runs so resume can restart from the last viable stage instead of replaying the whole loop
- [x] Add per-stage/provider latency and estimated cost accounting and feed it into adaptive routing
- [x] Add regression tests for failed-stage resume and cost/latency-aware routing, then verify with typecheck and full test suite

Review/result:
- Failed runs now persist `execution.retryHint`, and `resume()` accepts retryable failed runs in addition to paused runs. The resume path can now restart directly from saved stages like `iteration-tools`, `iteration-fix`, `write-files`, and `memory-store` when enough state exists.
- Unexpected mid-run failures no longer just bubble out and disappear. They are persisted as failed run states with explicit retry hints, which makes the new state machine materially useful instead of just descriptive.
- Execution summaries now include provider-level metrics derived from stage timings. Adaptive routing uses those metrics to penalize providers that are materially slower or more expensive when quality is otherwise comparable.
- Verified with `pnpm exec tsc --noEmit`, `pnpm test`, `node --import tsx --test tests/orchestrator.resume.test.ts tests/orchestrator-runtime.test.ts tests/execution-state-machine.test.ts tests/artifacts.test.ts`, and `node --import tsx ./bin/ai.js --help`.
