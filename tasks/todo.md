- [x] Inspect current review flow and define semantics for `ai review --staged` and `ai review --base <git-ref>`
- [x] Implement staged/base review modes and wire them into CLI
- [x] Add tests/docs and verify with typecheck + targeted tests

Review/result:
- `ai review --staged` now reviews only staged git changes, while `ai review --base <git-ref>` reviews the current repo state against the chosen base ref.
- The new modes reuse the same tool-check and reviewer pipeline as current-working-tree review, so the output shape stays consistent.
- Verified with `pnpm exec tsc --noEmit` and targeted tests for current-change review, workflow defaults, and resume glue.

- [x] Define semantics for `ai review --files <paths>` and README automation examples
- [x] Implement explicit file-scope review mode in CLI + current-change review pipeline
- [x] Add tests/docs and verify with typecheck + targeted review tests

Review/result:
- `ai review --files <path[,path2...]>` now lets operators review a precise file subset against `HEAD`, while `ai review --staged` and `ai review --base <git-ref>` keep their existing git-based scopes.
- Working-tree review now also uses `HEAD` as the baseline, so review diffs and summaries reflect real changes instead of comparing the current file contents to themselves.
- Verified with `pnpm exec tsc --noEmit`, `node --import tsx --test tests/current-change-review.test.ts`, and `node --import tsx ./bin/ai.js --help`.

- [x] Extend review workflow so `--files` can be combined with `--staged`
- [x] Extend review workflow so `--files` can be combined with `--base <git-ref>`
- [x] Add tests/docs and verify combined review scopes

Review/result:
- `ai review --staged --files ...` now reviews only the staged subset you explicitly name, while `ai review --base <git-ref> --files ...` does the same against a chosen base ref.
- The same file-scope filter is now supported across working-tree, staged, and base-ref review paths without creating a separate review pipeline.
- Verified with `pnpm exec tsc --noEmit`, `node --import tsx --test tests/current-change-review.test.ts`, and `node --import tsx ./bin/ai.js --help`.

- [x] Implement Phase A2: Docker-based container sandboxing for tool checks
- [x] Implement Phase B MVP: Dependency-aware context expansion using DependencyGraph
- [x] Add unit tests for DependencyGraph and ToolSandbox and verify with typecheck

Review/result:
- `tools.sandbox.mode = "docker"` now enables isolated tool execution via Docker, with support for environment passthrough and custom images.
- `DependencyGraph` automatically expands the context by including imported and importing files, significantly improving the AI's understanding of code relationships.
- Dry-run mode now skips command-based tool checks explicitly until a full isolated repo sandbox is available, avoiding misleading pass/fail results from an incomplete temp workspace.
- Verified with `pnpm exec tsc --noEmit` and 55 passing tests (including new suites for dependency graph and sandbox).

- [x] Define Phase B MVP scope for embedded vector search and safe fallback behavior
- [x] Implement `VectorIndex` chunking/search/persistence and wire it into orchestrator context expansion
- [x] Add tests/docs and verify with typecheck + targeted vector/dependency tests

Review/result:
- Phase B MVP now combines dependency-aware expansion with an embedded local vector index, so the orchestrator can pull semantically related files into `plan.readFiles` even when the planner misses them by name.
- The vector search implementation is local-first and reuses the existing `@xenova/transformers` embedder; when embeddings are unavailable, search still degrades safely to lexical ranking instead of hard-failing.
- Verified with `pnpm exec tsc --noEmit` and targeted tests for `VectorIndex`, `Context Intelligence`, and `DependencyGraph`.
