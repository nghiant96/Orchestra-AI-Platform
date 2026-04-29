# P0: Code Quality Foundation

## Tasks

### Phase 1: Modularization & Linting [DONE]
- [x] Tách `cli.ts` thành `cli/types.ts`, `cli/presets.ts`, `cli/arg-parser.ts`, vv...
- [x] Chạy thử CLI đảm bảo tương thích ngược
- [x] Thêm cấu hình ESLint chuẩn (`eslint.config.js`)
- [x] Thêm cấu hình Prettier chuẩn (`.prettierrc`, `.prettierignore`)
- [x] Fix các lỗi dependency (`@types/blessed`)

### Phase 2: Test Coverage [DONE]
- [x] Update `ai-system/core/provider-router.ts` unit tests (`provider-router.test.ts`)
- [x] Update `ai-system/core/run-executor.ts` unit tests (`run-executor.test.ts`)
- [x] Update `ai-system/core/context-intelligence.ts` unit tests (`context-intelligence.test.ts`)
- [x] Update `ai-system/agents/*.ts` unit tests (`agents.test.ts`)
- [x] Create Integration Tests (`orchestrator-integration.test.ts`)
- [x] Establish test configurations for `node:test` + `tsx`.

## Status: Completed

---

# Review Gemini Fixes Against Review_v4

## Tasks

- [x] Read `Review_v4.md` P0/P1 checklist
- [x] Map current changed files to review items
- [x] Inspect implementation and test changes
- [x] Run relevant quality gates
- [x] Record review result and remaining risk

## Review Result

- `pnpm run typecheck`: pass.
- `pnpm run lint`: pass.
- `pnpm test`: pass, 108/108 tests.
- `git diff --check`: fail due trailing whitespace in `eslint.config.js`.
- Review_v4 P0 items are functionally addressed by the Gemini patch, except the whitespace hygiene issue above.
# P0: Code Quality Foundation

## Tasks

### Phase 1: Modularization & Linting [DONE]
- [x] Tách `cli.ts` thành `cli/types.ts`, `cli/presets.ts`, `cli/arg-parser.ts`, vv...
- [x] Chạy thử CLI đảm bảo tương thích ngược
- [x] Thêm cấu hình ESLint chuẩn (`eslint.config.js`)
- [x] Thêm cấu hình Prettier chuẩn (`.prettierrc`, `.prettierignore`)
- [x] Fix các lỗi dependency (`@types/blessed`)

### Phase 2: Test Coverage [DONE]
- [x] Update `ai-system/core/provider-router.ts` unit tests (`provider-router.test.ts`)
- [x] Update `ai-system/core/run-executor.ts` unit tests (`run-executor.test.ts`)
- [x] Update `ai-system/core/context-intelligence.ts` unit tests (`context-intelligence.test.ts`)
- [x] Update `ai-system/agents/*.ts` unit tests (`agents.test.ts`)
- [x] Create Integration Tests (`orchestrator-integration.test.ts`)
- [x] Establish test configurations for `node:test` + `tsx`.

## Status: Completed

---

# Review Gemini Fixes Against Review_v4

## Tasks

- [x] Read `Review_v4.md` P0/P1 checklist
- [x] Map current changed files to review items
- [x] Inspect implementation and test changes
- [x] Run relevant quality gates
- [x] Record review result and remaining risk

## Review Result

- `pnpm run typecheck`: pass.
- `pnpm run lint`: pass.
- `pnpm test`: pass, 108/108 tests.
- `git diff --check`: fail due trailing whitespace in `eslint.config.js`.
- Review_v4 P0 items are functionally addressed by the Gemini patch, except the whitespace hygiene issue above.

---

# Review Gemini P1 Fixes Against Review_v4

## Tasks

- [x] Read `Review_v4.md` P1 checklist
- [x] Map current changed files to P1 items
- [x] Inspect CLI, formatter, agent, prompt, and cost changes
- [x] Run relevant quality gates
- [x] Record review result and remaining risk

## Review Result

- CLI and formatter split addresses Review_v4 P1 3.1 and 3.2 structurally.
- Prompt updates and generator rules summary partially address P1 3.3 and 3.4.
- `pnpm run typecheck` fails in `ai-system/cli/handlers/review-handler.ts`.
- `pnpm run lint`: pass.
- `pnpm test`: pass, 108/108 tests.
- `git diff --check`: pass.
- Cost tracking remains incomplete because execution summary still derives cost from duration instead of provider `getUsage()` metrics.
- VectorIndex P1 3.6 remains unchanged and still TypeScript-AST-only.

---

# Review Gemini Follow-up Fixes

## Tasks

- [x] Recheck changed diff
- [x] Verify previous 3 review findings
- [x] Run typecheck, lint, tests, and diff check
- [x] Record review result and remaining risk

## Review Result

- Previous P1 typecheck finding is fixed: `pnpm run typecheck` passes.
- `pnpm run lint` exits 0 but reports two unused `eslint-disable-line` warnings in `ai-system/cli/handlers/review-handler.ts`.
- `pnpm test`: pass, 108/108 tests.
- `git diff --check`: pass.
- Cost tracking finding remains open: execution summary still uses duration-based cost.
- VectorIndex finding remains open: symbol detection is still TypeScript-family only.

---

# Review And Fix Gemini Final P1 Updates

## Tasks

- [x] Inspect latest Gemini changes
- [x] Verify cost tracking and VectorIndex fixes
- [x] Patch remaining integration and lint issues
- [x] Run full quality gates
- [x] Record final result

## Review Result

- Fixed review handler destructuring so `outputJson` and `savePath` are used directly with no stale lint suppressions.
- Fixed provider metrics aggregation so token usage cost is used while provider duration/stage metrics are preserved when usage is absent.
- Wired current-change and failing-check review summaries to reviewer usage metrics.
- Preserved planner usage after implementation rerouting by carrying the actual planning runtime into run summaries.
- Added symbol-aware line-based chunking for Python, Go, Rust, Java, Kotlin, and Swift.
- Added tests for token-based budget cost and non-TypeScript symbol-aware vector chunks.
- `pnpm run typecheck`: pass.
- `pnpm run lint`: pass.
- `pnpm test`: pass, 110/110 tests.
- `git diff --check`: pass.

---

# Review_v3 Remaining P0/P1 Plan

## Tasks

- [x] Extract VectorIndex symbol parsing behind a parser registry
- [x] Add non-Node tool adapters for Python, Go, and Rust
- [x] Move provider token cost logic into a cost calculator
- [x] Add pre-generation budget guard using existing run budgets
- [x] Add prompt examples and optional few-shot injection
- [x] Add focused tests for each new behavior
- [x] Run `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `git diff --check`

## Review Result

- Added `CodeSymbolParser` registry with TypeScript AST, line-based Python/Go/Rust/Java/Kotlin/Swift parsers, and plain-text fallback.
- Added non-Node tool adapters with Python/Go/Rust detection, explicit command precedence, and sandbox preservation.
- Moved token cost estimation to `ai-system/utils/cost-calculator.ts` and added pre-generation budget stop using `execution.budgets.max_cost_units`.
- Added optional prompt example loading for planner/generator/reviewer/fixer and stricter agent validation for out-of-scope files/issues.
- Verification: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (118/118), `git diff --check`, `pnpm ai --help`, and `pnpm ai doctor` all pass.

---

# Review_v3 Phase 4/5 Completion Plan

## Tasks

- [x] Inspect current TUI, checkpoint, artifact, and usage flows
- [x] Add dashboard visibility for state-machine progress, provider usage/cost, and latest diff/artifact context
- [x] Add manual checkpoint support for editing `plan.json` and `context.json` before generation
- [x] Preserve resume/retry state-machine artifacts and provider usage reporting
- [x] Add focused tests for checkpoint/dashboard behavior
- [x] Run `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `git diff --check`

## Review Result

- Upgraded the TUI dashboard to show state-machine stages, provider cost metrics, budget status, artifact path, and latest diff summary.
- Added editable manual checkpoint loading for `01-plan/plan.json` and `02-context/context.json` plus `02-context/files/*`.
- Wired dashboard updates through execution transitions, generation/review iterations, and pre-generation cost estimates without breaking resume/retry artifacts.
- Updated CLI help/result text to explain editable checkpoint artifacts.
- Verification: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (120/120), `git diff --check`, `pnpm ai --help`, and `pnpm ai doctor` all pass.

---

# Roadmap Parser Sandbox Queue Prompt Implementation

## Tasks

- [x] Add optional Tree-sitter parser mode with safe fallback
- [x] Improve Docker sandbox image resolution and preflight UX
- [x] Add file-backed server job queue and HTTP job APIs
- [x] Add project/global custom prompt override support
- [x] Document custom prompts, sandbox profiles, and queue APIs
- [x] Add focused parser, sandbox, queue, and prompt tests
- [x] Run `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `git diff --check`, `pnpm ai doctor`, and server health smoke

## Review Result

- Optional Tree-sitter parsing is now configurable and falls back safely to TypeScript AST, line-based parsers, or fixed chunks.
- Docker sandboxing now resolves profile images, reports effective image details, skips missing Docker/images with actionable messages, and supports opt-in auto-build.
- The server now keeps synchronous `POST /run` and adds file-backed queue endpoints for create/list/get/cancel job flows.
- Prompt templates and examples can be overridden from project/global-safe paths with built-in fallback and path traversal rejection.
- Verification: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (133/133), `git diff --check`, `pnpm ai doctor`, and server `/health` smoke all pass.

---

# README Refresh

## Tasks

---

# Fix Package-Scoped Tool Checks

## Tasks

- [x] Inspect failed job `mojmrga2-du2jxoo2` artifacts and tool outputs
- [x] Reproduce root `lint` and `typecheck` failures
- [x] Patch tool resolution to prefer the changed package for lint/typecheck
- [x] Run focused tool-executor tests
- [x] Record review result

## Review Result

- Root checks in failed job were not the right surface for `dashboard/src/App.tsx`: root `pnpm run lint` and `pnpm run typecheck` report unrelated backend/root configuration failures.
- `runToolChecks` now prefers the changed package command/tsconfig before root scripts when all changed files belong to one package.
- Verification: `node --import tsx --test tests/tool-executor.test.ts` passed 18/18, `pnpm exec eslint ai-system/core/tool-executor.ts tests/tool-executor.test.ts` passed, actual dashboard `pnpm run lint` passed, actual dashboard `pnpm run build` passed, and a direct `runToolChecks` smoke for `dashboard/src/App.tsx` selected `dashboard` package lint/typecheck and passed.
- Full repo `pnpm test`/root typecheck remain blocked by pre-existing unrelated failures in `ai-system/types.ts`, `ai-system/core/orchestrator.ts`, `ai-system/utils/cost-calculator.ts`, and `tests/server-queue.test.ts`.

- [x] Review README against current CLI, sandbox, queue, prompt, and parser behavior
- [x] Patch stale wording and missing environment/config details
- [x] Run README-focused hygiene checks

## Review Result

- README now documents current capabilities, requirements, pnpm usage, vector parser behavior, non-Node adapters, Docker sandbox profiles, queue API, prompt overrides, and server environment variables.
- Verification: `git diff --check README.md tasks/todo.md` passes, README code fences are balanced, and stale `npm run ai` / `Phase B` wording is removed.

---

# Dashboard V3 Remaining Issues

## Tasks

- [x] Read `tasks/dashboard-v3-plan.md` and current workspace guidance
- [x] Run current quality gates to identify remaining dashboard issues
- [x] Fix dashboard TypeScript and lint failures
- [x] Run `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run dashboard:build`, and `git diff --check`
- [x] Record final result

---

# Re-run Event Feed Filter UI Job

## Tasks

- [x] Inspect current dirty worktree and CLI execution path
- [x] Run the requested UI task through the AI system
- [x] Inspect resulting job/run artifacts
- [x] Debug and patch any pipeline failure
- [x] Run targeted verification
- [x] Record review result

## Review Result

- First rerun failed in generation because CLI passed raw `process.argv`, so the task included the Node executable and CLI path; fixed CLI parsing to use user args only.
- Generation then reached checks but failed on unrelated package-wide lint and `npm audit` without a package lock; fixed generated-file safety to allow planned read-file updates, scoped generic `eslint .` package lint to changed files, preserved command stdout/stderr through retries, switched strict-reviewer audit to pnpm/HTTPS, and added a protobufjs override for the reported audit vulnerability.
- Final rerun succeeded and wrote `dashboard/src/App.tsx`; tool checks passed: changed-file lint, dashboard typecheck, and security audit.
- Extra verification: focused tests passed 31/31, dashboard `pnpm exec eslint src/App.tsx` passed, dashboard `pnpm run build` passed, and `git diff --check` passed for touched files.

## Review Result

- Fixed remaining dashboard TypeScript issues in config form state, provider map typing, optional config values, and NodeNext type imports.
- Removed unused React/cn imports from dashboard components.
- Removed trailing whitespace from changed files flagged by `git diff --check`.
- Verification: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (133/133), `pnpm run dashboard:build`, and `git diff --check` pass.
- `pnpm run dashboard:build` still reports the Vite large chunk warning for the 742.75 kB JS bundle; this is a warning, not a build failure.

---

# Dashboard App.tsx Refactor Follow-up

## Tasks

- [x] Inspect current `dashboard/src/App.tsx` split and extracted dashboard components
- [x] Run typecheck, lint, and dashboard build to identify remaining refactor issues
- [x] Finish import/type cleanup across extracted components
- [x] Move `App.tsx` job/config fetching onto extracted hooks
- [x] Remove `ConfigView` synchronous setState-in-effect pattern
- [x] Run full verification and record result

## Review Result

- `App.tsx` now delegates job/config loading to `useJobs(3000)` and `useConfig`, leaving it focused on view state, filters, submission, and layout.
- Extracted dashboard components now use type-only imports where required by Vite/TypeScript `verbatimModuleSyntax`.
- `ConfigView` now initializes editable form state when entering edit mode, avoiding synchronous setState inside an effect.
- Verification: `pnpm run typecheck`, `pnpm run lint`, `pnpm run dashboard:build`, `pnpm test` (133/133), and `git diff --check` pass.
- `pnpm run dashboard:build` still reports the existing large chunk warning for the dashboard JS bundle; it does not fail the build.

---

# Tool Requirement Guard Upgrade

## Tasks

- [x] Inspect planner/review execution flow for where deterministic task checks fit
- [x] Add UI filter requirement extraction and plan enhancement
- [x] Add generated-file validation for Event Feed filter requirements
- [x] Add focused tests for plan enhancement and validation
- [x] Run targeted verification and record result

## Review Result

- Added deterministic Event Feed filter requirement guards so planner notes explicitly call out no horizontal scroll, header-above-filter layout, and per-filter job counts when the task asks for them.
- The planner now promotes `dashboard/src/App.tsx` into write targets for Event Feed filter tasks when that file is relevant context, avoiding generated updates being dropped as unsafe.
- The generation loop now merges requirement coverage issues into pre-review issues, so a candidate can be sent back to the fixer when it still uses horizontal scrolling or only renders a global count.
- Verification: focused tests passed 29/29, ESLint passed for touched system/test files, and `git diff --check` passed for touched files.
- Full `pnpm exec tsc --noEmit` remains blocked by pre-existing unrelated type errors in queue/server/types/cost/dashboard hook files.

---

# Fix Existing TypeScript Errors

## Tasks

- [x] Consolidate duplicate failure typing and provider usage model metadata
- [x] Align queue/server resume and pending approval metadata types
- [x] Add resume cancellation signal typing through orchestrator resume
- [x] Tighten plugin manifest safety narrowing
- [x] Fix dashboard NodeNext type imports
- [x] Run typecheck, focused lint, queue/resume/server tests, and diff hygiene

## Review Result

- `pnpm exec tsc --noEmit`: pass.
- Focused ESLint for touched type/queue/orchestrator/plugin/server/cost/dashboard hook files: pass.
- `node --import tsx --test tests/orchestrator.resume.test.ts tests/server-queue.test.ts tests/workflow-modes.test.ts`: pass, 12/12.
- `git diff --check`: pass.

---

# Green Baseline And Queue Approval Fix

## Tasks

- [x] Fix root lint and stale cost test expectation
- [x] Add reliable queue stop/drain behavior for server tests
- [x] Wire queue approval mode to `skip_approval`
- [x] Replace loose artifact-run job status mapping with typed helpers
- [x] Scope package build checks for dashboard changes when build checks are enabled
- [x] Run full baseline gates and record result

## Review Result

- Queue jobs now derive approval behavior from effective rules: `skip_approval: true` runs without plan approval, while false or missing keeps manual review.
- `FileBackedJobQueue` now has a graceful `stop()` path and tests wait for terminal queue states before temp workspace cleanup.
- Artifact run summaries now map through typed queue-job helpers instead of `status as any`.
- Tool checks can select package build scripts for package-scoped changes such as `dashboard/**` when build checks are enabled.
- Verification: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (144/144), `pnpm run dashboard:build`, `pnpm audit --audit-level high --registry https://registry.npmjs.org`, and `git diff --check` all pass.
