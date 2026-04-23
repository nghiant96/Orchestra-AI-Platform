- [x] Inspect current review flow and define semantics for `ai review --staged` and `ai review --base <git-ref>`
- [x] Implement staged/base review modes and wire them into CLI
- [x] Add tests/docs and verify with typecheck + targeted tests

Review/result:
- `ai review --staged` now reviews only staged git changes, while `ai review --base <git-ref>` reviews the current repo state against the chosen base ref.
- The new modes reuse the same tool-check and reviewer pipeline as current-working-tree review, so the output shape stays consistent.
- Verified with `pnpm exec tsc --noEmit` and targeted tests for current-change review, workflow defaults, and resume glue.
