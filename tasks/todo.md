- [x] Define explicit execution state machine contract and migrate execution summary to stage-driven data
- [x] Persist stage transitions into artifacts/timeline while keeping resume compatibility with existing run-state readers
- [x] Refactor orchestrator and run executor to drive planning/context/generate/check/review/write/store through state machine helpers
- [x] Add regression tests for stage transitions, pause/resume compatibility, and CLI-visible execution stages

Review/result:
- Execution flow is now driven by an explicit state machine instead of implicit step logging. The new contract records entered/completed/failed/paused/cancelled transitions and carries `currentStage` / `terminalStage` in `ExecutionSummary`.
- Live runs now append execution-stage transition events to artifact timelines as they happen, while `run-state.json` and CLI summaries expose the richer execution state without breaking older summaries that only had step logs.
- `run-executor` now models generation, fix, tool checks, review, write, and memory-store as separate execution stages, and `orchestrator` uses the same state machine for planning/context/resume flow. This makes the next step toward partial retry/resume much cleaner.
- Verified with `pnpm exec tsc --noEmit`, `pnpm test`, and `node --import tsx ./bin/ai.js --help`.
