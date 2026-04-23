- [x] Inspect tool executor hooks for scoped lint/test execution
- [x] Implement Phase 4 MVP: scoped execution for lint/test with repo heuristics
- [x] Add tests/docs and verify with typecheck + test suite

Review/result:
- Tool execution now auto-prefers scoped lint/test scripts such as `lint:changed` and `test:related` when they exist.
- When all changed files belong to one workspace package, lint/test now run from that package directory instead of the whole repo.
- Tool summaries/results now expose `scope` and `workingDirectory`, and verification passed with `pnpm exec tsc --noEmit` plus `pnpm test`.
