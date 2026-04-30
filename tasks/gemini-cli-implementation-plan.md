# Gemini CLI Implementation Plan

Last updated: 2026-04-30

This plan is the handoff guide for using Gemini CLI to implement the next roadmap work without drifting, over-editing, or breaking the current green baseline.

## Current Target

Implement `v1.0 - Senior Workflow Integration` next.

`v0.9 - Release Candidate Packaging` is complete. Do not restart Phase 8 unless explicitly asked.

Implement roadmap phases in this order:

1. Phase 9 - v1.0 Senior Workflow Integration.
2. Phase 10 - v1.1 Staff-Level Review And Test Planning.
3. Phase 11 - v1.2 Artifact To PR Workflow.
4. Phase 12 - v1.3 Safe Refactor Mode.
5. Phase 13 - v1.4 Contract Intelligence.
6. Phase 14 - v1.5 Operator Trust And Team Scale.

Do not start a later phase until the previous phase acceptance is complete and all required gates are green.

## Required Context To Read First

Gemini must read these files before editing:

1. `tasks/roadmap.md`
2. `tasks/implementation-plan.md`
3. `tasks/todo.md`
4. `tasks/lessons.md`
5. `docs/OPERATIONS.md`
6. `README.md`
7. `package.json`
8. Relevant implementation files only after the target task is chosen.

Gemini must not infer current status from old memory or old roadmap text. The source of truth is the files above plus the current test output.

## Non-Negotiable Guardrails

- Do not use broad regex or bulk replacements across the repo.
- Do not edit unrelated files while completing a phase.
- Do not change serialized type shapes without checking JSON persistence and artifact readers.
- Keep imports consistent with existing project style, especially `node:` imports in backend code.
- Do not remove legacy compatibility unless a migration and regression test are included.
- Do not add new frameworks, build tools, or package dependencies unless the current phase explicitly requires them.
- Do not mark a task complete until the required verification commands pass.
- If tests fail, investigate the failing test and root cause instead of weakening assertions.
- If behavior is ambiguous, prefer docs/checks/scripts over feature expansion.
- Any long-lived server resource created by `createAiSystemServer()` must be disposed on `server.close()`.
- Timers, intervals, watchers, sockets, and background workers must either be cleared on close or use `unref()` when appropriate.
- When `pnpm test` appears to hang after all assertions pass, inspect active handles/processes before changing tests.

## Known Lessons Gemini Must Respect

From `tasks/lessons.md`:

- Never batch-modify files outside scope.
- `ProviderSummary` is serialized data. Do not change it into class instances or method-bearing objects.
- Match existing import conventions.
- In environments with a required completion tool, use that tool. In this repo workflow, update task docs and provide a concise completion summary.
- Server tests can hang when background intervals survive `server.close()`. Keep server lifecycle cleanup explicit and covered by targeted tests.

## Recent Gemini Hang Investigation

On 2026-04-30, the command below appeared to hang during Phase 9 work:

```bash
pnpm run typecheck && pnpm run lint && pnpm test
```

Root cause:

- `createAiSystemServer()` started a 24-hour maintenance `setInterval`.
- The interval was not stored or cleared when tests called `server.close()`.
- Node's test runner finished assertions but the process stayed alive because the interval kept the event loop open.

Fix applied:

- Store `maintenanceTimer`.
- Set `isClosed` when the HTTP server closes.
- Clear the interval in the `server.on("close")` handler.
- Call `maintenanceTimer.unref?.()` so the timer does not keep test/CLI processes alive.
- Guard async maintenance setup if `loadRules()` resolves after the server already closed.

Verification result:

```bash
pnpm exec node --import tsx --test tests/server-queue.test.ts
pnpm run typecheck && pnpm run lint && pnpm test
git diff --check
```

All checks passed after the fix. Gemini must not remove this lifecycle cleanup while implementing Phase 9.

## Gemini Execution Playbook For All Remaining Phases

Gemini must implement the roadmap sequentially. Each numbered phase should be a small reviewable diff or a short series of sub-phase diffs. Do not combine roadmap phases unless explicitly instructed.

### Universal Preflight Before Any Phase

Run/read:

```bash
git status --short
sed -n '180,340p' tasks/roadmap.md
sed -n '340,520p' tasks/implementation-plan.md
sed -n '50,90p' tasks/todo.md
```

Then inspect only the files needed for the selected phase. Suggested search commands:

```bash
rg -n "run-state|artifact-index|PersistedRunState|writeArtifactIndex|QueueJob|createAiSystemServer|POST.*jobs|readJsonBody" ai-system tests
rg -n "review workflow|collectReviewChanges|mode.*review|parseArgs|task|TaskContract|contract" ai-system tests dashboard/src
rg -n "applyArtifact|stage|commit|branch|pull request|git" ai-system tests README.md docs
```

Rules:

- If `git status --short` shows unrelated user edits in target files, stop and report the conflict.
- If the selected phase touches server code, run `tests/server-queue.test.ts` directly before the full test suite.
- If the selected phase touches artifact/run-state shape, add backward-compatibility tests.
- If the selected phase touches dashboard code, run `pnpm run dashboard:build` and `pnpm --dir dashboard test`.
- If a phase requires network writes, implement preview/approval first and stop before real writes unless explicitly approved.
- Update `tasks/todo.md` as each sub-phase actually completes.

## Phase 9 Playbook - v1.0 Senior Workflow Integration

Gemini must implement Phase 9 in this exact order. Each phase should be a small reviewable diff with tests. Do not combine phases unless explicitly instructed.

### Step 1 - Implement Phase 9.1 First

Goal: create a plain-data external task model and parser. This is infrastructure only.

How:

1. Add JSON-serializable types in `ai-system/types.ts`, for example:
   - `ExternalTaskProvider = "github"`
   - `ExternalTaskKind = "issue" | "pull_request"`
   - `ExternalTaskRef`
   - `ExternalTaskUpdatePreview` only if needed by Phase 9.5 later.
2. Add a focused parser module, preferably `ai-system/core/external-task.ts`.
3. Parser should accept:
   - `https://github.com/owner/repo/issues/123`
   - `https://github.com/owner/repo/pull/456`
4. Parser should reject:
   - non-GitHub URLs
   - missing owner/repo/id
   - non-numeric ids
   - unsupported GitHub paths like `/commit/`, `/tree/`, `/actions/`
5. Return normalized metadata:
   - `provider`
   - `kind`
   - `url`
   - `owner`
   - `repo`
   - `number`
   - `sourceText`
6. Add tests, preferably `tests/external-task.test.ts`.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm exec node --import tsx --test tests/external-task.test.ts
pnpm test
git diff --check
```

Update `tasks/todo.md`: mark only Phase 9.1 done.

### Step 2 - Implement Phase 9.2 After 9.1 Passes

Goal: allow manual GitHub Issue URL intake and convert it into an internal task context. No GitHub API calls.

How:

1. Find existing CLI/server task intake:
   - CLI arg parsing and task handler.
   - server `POST /jobs` body handling in `ai-system/server-app.ts`.
2. Add a small normalization helper, likely in `ai-system/core/external-task.ts`, that can produce a task prefix/context from an `ExternalTaskRef`.
3. Keep the original `task` string intact. Do not replace it with an object.
4. Attach external task metadata separately for downstream persistence.
5. If the input is a GitHub Issue URL only, generate a clear task prompt such as:
   - source issue URL
   - repo path must be local/current checkout
   - ask planner to inspect local code first
   - require expected files and test plan before implementation
6. Server job creation must still work for normal plain text tasks.
7. Invalid URLs should fail clearly only when the user explicitly uses an external-task URL mode. Plain text containing URLs should not become brittle.

Tests:

- Plain text task still enqueues/runs.
- GitHub issue URL normalizes into `externalTask.kind === "issue"`.
- Invalid external URL returns a clear error in the chosen intake path.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm exec node --import tsx --test tests/server-queue.test.ts
pnpm test
git diff --check
```

Update `tasks/todo.md`: mark only Phase 9.2 done.

### Step 3 - Implement Phase 9.3 After 9.2 Passes

Goal: support manual GitHub PR URL intake for staff-level review output. No external writes.

How:

1. Reuse the Phase 9.1 parser for `/pull/:number`.
2. Route PR URLs toward review-oriented task context, not implementation-first context.
3. The generated review prompt/context must require:
   - findings first
   - severity/risk ordering
   - file/line grounding when local diff provides it
   - open questions
   - test gaps
   - summary last
4. Do not assume the local branch equals the remote PR. Tell the reviewer to inspect local git status/diff and state assumptions.
5. Persist the external task metadata but keep comments/status updates disabled.

Tests:

- PR URL parses as `pull_request`.
- PR intake creates review-oriented context.
- Normal review workflow still behaves as before when no PR URL is present.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

Update `tasks/todo.md`: mark only Phase 9.3 done.

### Step 4 - Implement Phase 9.4 After 9.3 Passes

Goal: persist external task metadata into artifacts without breaking old runs.

How:

1. Locate run-state and artifact-index writers in `ai-system/core/artifacts.ts`.
2. Add optional fields only, for example:
   - `externalTask?: ExternalTaskRef`
3. Ensure `version` remains numeric and old missing fields are accepted.
4. Update loaders/normalizers so old artifacts still deserialize.
5. Ensure queue job or run summary maps external metadata if needed by dashboard/API.
6. Add tests that load:
   - old run-state without `externalTask`
   - new run-state with `externalTask`
   - artifact-index with and without `externalTask`

Do not:

- Change `task: string` into an object.
- Rename existing persisted fields.
- Require metadata for all runs.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

Update `tasks/todo.md`: mark only Phase 9.4 done.

### Step 5 - Implement Phase 9.5 Last

Goal: define approval-gated external update previews. Still no real GitHub writes unless explicitly approved in a future phase.

How:

1. Add a plain-data preview model for external updates:
   - target URL
   - action type, e.g. `comment`, `status`, `label`, `close`
   - preview body/payload
   - approval state
   - actor/approvedAt when approved
2. Store previews in run-state/artifacts as optional metadata.
3. Expose previews through existing job detail/API if there is already a natural route. Do not create a large new API surface.
4. Add dry-run output that shows exactly what would be sent externally.
5. Add a hard guard: no token, network call, comment, status, or issue state change happens in Phase 9.5.

Tests:

- Preview can be created and persisted.
- Preview defaults to not approved.
- No external update function is invoked by normal job completion.
- Existing server tests still close cleanly.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm exec node --import tsx --test tests/server-queue.test.ts
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
git diff --check
```

Update `tasks/todo.md`: mark Phase 9.5 done and add a Phase 9 result note.

## Phase 10 Playbook - v1.1 Staff-Level Review And Test Planning

Goal: make review and test planning useful to a senior engineer, not just a pass/fail wrapper around lint and tests.

Implement Phase 10 in this order.

### Step 10.1 - Blast-Radius Review Context

How:

1. Inspect existing review and diff collection:
   - `collectReviewChanges`
   - dependency graph utilities
   - tool check result structures
   - run-state execution summaries
2. Add a focused review-context builder, preferably under `ai-system/core/`.
3. Inputs should include changed files, planned write targets, existing dependency graph output, contract results, and test files when discoverable.
4. Output must be plain JSON-serializable:
   - changed files
   - likely affected files/flows
   - related tests
   - risk signals
   - confidence/limitations
5. Keep it deterministic first. Do not require an LLM call for blast-radius construction.

Tests:

- Single changed file maps to direct affected context.
- Multiple files preserve stable ordering.
- Missing dependency data degrades gracefully.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Step 10.2 - PR-Grade Review Output Format

How:

1. Extend reviewer prompt/context so findings lead the output.
2. Required finding fields:
   - severity or priority
   - file path
   - line when available
   - risk/behavioral impact
   - suggested fix
3. Separate:
   - blocking findings
   - non-blocking findings
   - open questions
   - residual risks
   - summary
4. Keep style-only comments out unless they affect correctness, maintainability, or established project rules.
5. Add parser/formatter tests if output is structured.

Do not:

- Replace existing review summary data without migration.
- Make the reviewer fail because a line number is unavailable.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Step 10.3 - Missing-Test Detection

How:

1. Build deterministic heuristics:
   - risky paths require targeted tests
   - server/queue changes require `tests/server-queue.test.ts` or equivalent
   - dashboard changes require dashboard build/test
   - artifact/schema changes require backward-compatibility tests
   - config/security/dependency changes require config/security relevant checks
2. Output required vs optional tests.
3. Surface missing tests in review and final run summaries.
4. Add tests covering each heuristic.

Do not:

- Block docs-only changes with irrelevant test requirements.
- Treat every change as needing full end-to-end tests.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Step 10.4 - Pre-Implementation Test Plan

How:

1. Add test-plan generation to issue mode before implementation.
2. The plan should include:
   - commands to run
   - target test files to add/update
   - behavior each test proves
   - residual risk if a test is not practical
3. Persist the test plan in run-state/artifacts as optional plain data.
4. Keep old artifacts readable.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Step 10.5 - Reconcile Test Plan With Actual Checks

How:

1. Compare planned checks with actual `latestToolResults`.
2. Mark each planned check as:
   - passed
   - failed
   - skipped with reason
   - not run
3. Surface reconciliation in CLI output, server job detail, and dashboard only if existing surfaces naturally support it.
4. Add tests for passed, failed, skipped, and not-run states.

Acceptance:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
git diff --check
```

Update `tasks/todo.md`: mark Phase 10 items as complete only after these checks pass.

## Phase 11 Playbook - v1.2 Artifact To PR Workflow

Goal: turn successful artifacts into reviewable branch/commit/PR handoff while preserving operator approval.

Implement Phase 11 in this order.

### Step 11.1 - Safe Branch Name Generation

How:

1. Add a deterministic helper under `ai-system/core/`, not inline in CLI handlers.
2. Inputs:
   - task title/text
   - external task metadata when present
   - run id
3. Output:
   - safe branch name
   - reason/source fields for audit
4. Use repo branch prefix convention unless user config overrides it:
   - default prefix should stay compatible with `codex/`.
5. Add collision handling by appending short run id or timestamp.

Tests:

- Sanitizes spaces/symbols.
- Includes issue/PR number when available.
- Avoids protected branch names.
- Stable output for same input.

### Step 11.2 - Approval-Gated Apply, Stage, Commit

How:

1. Reuse existing artifact apply code. Do not duplicate patch application logic.
2. Add an explicit approval boundary before:
   - applying artifacts
   - staging files
   - committing
3. Never run destructive git commands.
4. If there are unrelated working tree changes, stop or scope carefully; do not revert them.
5. Audit each action with actor, cwd, run id, branch, files, and result.

Tests:

- Dry-run preview does not apply/stage/commit.
- Approval path calls apply/stage/commit helpers in order.
- Dirty unrelated changes are detected and reported.

### Step 11.3 - Commit Message Generation

How:

1. Generate from run-state, task, external metadata, files changed, and tests run.
2. Keep format concise:
   - subject
   - optional body with tests/risks
3. Do not invent tests or claims not present in tool results.
4. Add tests for issue metadata, plain task, and failed/missing test signals.

### Step 11.4 - PR Description Generation

How:

1. Generate PR body from verified run data:
   - summary
   - implementation notes
   - tests run
   - risks/residual gaps
   - rollback notes
   - artifact links/paths
2. Include external task links when present.
3. Mark unknowns explicitly instead of fabricating.
4. Add tests for all sections.

### Step 11.5 - Optional GitHub PR Creation Preview

How:

1. Implement preview and approval first.
2. Do not require GitHub token for local artifact/commit workflow.
3. If a real GitHub command/API is added, hide it behind explicit operator approval and config.
4. Persist audit event for preview and approval.

Acceptance for Phase 11:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
git diff --check
```

Update `tasks/todo.md`: include branch/commit/PR preview result notes.

## Phase 12 Playbook - v1.3 Safe Refactor Mode

Goal: let senior engineers plan large refactors safely through analysis-first, small-batch execution.

Implement Phase 12 in this order.

### Step 12.1 - Read-Only Refactor Analysis Mode

How:

1. Add a CLI/server mode flag or task classification that clearly means analysis-only.
2. Build dependency/file grouping from existing dependency graph and changed-file utilities.
3. Output:
   - proposed refactor goal
   - affected files
   - dependency clusters
   - risk areas
   - tests to run
   - proposed batches
4. Analysis mode must not write files.

Tests:

- Analysis produces batches without writes.
- Dependency graph failure degrades to file/path-based grouping.

### Step 12.2 - Separate Mechanical From Behavioral Changes

How:

1. Add plan fields that classify each proposed change:
   - mechanical
   - behavioral
   - mixed
2. Mechanical changes need scoped verification.
3. Behavioral changes need stronger tests and review.
4. Prompt reviewers to reject mixed batches that are too broad.

### Step 12.3 - Split Large Refactors Into PR-Sized Batches

How:

1. Add batch-sizing heuristics:
   - max files
   - max estimated lines
   - community/module boundary
   - test ownership
2. Produce stable batch ids.
3. Each batch must include files, rationale, verification, rollback.

### Step 12.4 - Per-Batch Verification And Rollback Notes

How:

1. Attach specific commands per batch.
2. Include rollback instructions that avoid destructive commands by default.
3. Store batch plans in artifacts as optional plain data.

### Step 12.5 - Broad Rewrite Blocker

How:

1. Detect high-risk patterns:
   - broad regex replacement
   - repo-wide rewrite
   - generated changes across unrelated modules
2. Require explicit approval and scope.
3. Add tests based on the lesson about broad regex replacements.

Acceptance for Phase 12:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

Update `tasks/todo.md`: include analysis-only proof and broad-rewrite guard proof.

## Phase 13 Playbook - v1.4 Contract Intelligence

Goal: make task contracts modular, explainable, and easier to improve from project history.

Implement Phase 13 in this order.

### Step 13.1 - Split Domain Extractors

How:

1. Inspect `ai-system/core/task-requirements.ts` and tests first.
2. Create domain extractor modules, for example:
   - UI/layout
   - API/schema
   - config
   - security/dependency
   - tests
   - data/migrations
3. Preserve existing public behavior.
4. Move tests incrementally; do not rewrite all assertions at once.

### Step 13.2 - Add Extractor Registry

How:

1. Add a registry that accepts deterministic extractors.
2. Registry output should preserve stable ordering.
3. New domains must not require editing a monolithic switch.
4. Add tests for registration, ordering, and duplicate handling.

### Step 13.3 - Optional LLM-Assisted Suggestions Behind Validation

How:

1. LLM suggestions must be optional and disabled by default unless configured.
2. Suggestions must pass deterministic schema validation before use.
3. Output must explain why a contract was suggested.
4. Never let LLM suggestions silently override deterministic contracts.

### Step 13.4 - Targeted Fixer Hints

How:

1. Contract failures should include:
   - failed requirement
   - affected file(s)
   - suggested repair
   - verification command
2. Keep hints specific and concise.
3. Add tests for UI, API, security/dependency, and test-plan failures.

### Step 13.5 - Contract Coverage Trends

How:

1. Aggregate contract pass/fail counts from existing artifacts.
2. Expose trends by project and task type through existing stats/API surfaces if appropriate.
3. Dashboard changes should use existing chart/panel patterns.
4. Avoid adding a new analytics store unless necessary.

Acceptance for Phase 13:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
git diff --check
```

Update `tasks/todo.md`: include compatibility note for old task contracts.

## Phase 14 Playbook - v1.5 Operator Trust And Team Scale

Goal: mature observability, schema versioning, retention, dashboard smoke, identity, and integrations.

Implement Phase 14 in this order. This phase is large; each step should be a separate Gemini run.

### Step 14.1 - Schema Versions And Normalizers

How:

1. Inventory persisted/public payloads:
   - run-state
   - artifact-index
   - audit events
   - queue jobs
   - API responses
2. Add missing `version` fields only where useful.
3. Add normalizers/migration helpers for old shapes.
4. Add tests that load old fixtures or synthetic old payloads.
5. Do not break existing dashboard/API consumers.

### Step 14.2 - Retention Policy

How:

1. Extend existing retention behavior instead of adding parallel cleanup loops.
2. Cover artifacts, audit events, logs, and queue records.
3. Make retention configurable and disabled-safe.
4. Long-lived cleanup timers must be cleared on `server.close()` and use `unref()` where appropriate.
5. Add tests for cleanup and no-cleanup cases.

### Step 14.3 - Health History And Operational Metrics

How:

1. Add metrics from existing data first:
   - queue latency
   - job duration
   - retry rate
   - failure classes
   - provider degradation
   - cost trends
2. Prefer aggregation from artifacts/audit/queue over a new database.
3. Surface through `/stats` or a clearly named existing API route.
4. Dashboard should stay dense and operational, not marketing-style.

### Step 14.4 - Browser-Level Dashboard Smoke

How:

1. Inspect existing dashboard test setup.
2. Add Playwright or equivalent only if already present or explicitly approved.
3. Cover release-critical flows:
   - loads dashboard
   - shows health/stats/jobs
   - opens job detail
   - displays approval/test/contract info when present
4. Keep screenshots/artifacts out of git unless project convention allows them.

### Step 14.5 - Identity Provider Role Mapping

How:

1. Preserve existing viewer/operator/admin role model.
2. Add provider mapping as config, not hardcoded users.
3. Keep local token mode working.
4. Never log tokens or identity secrets.
5. Add tests for role resolution and fallback.

### Step 14.6 - Webhook/Event Export

How:

1. Export audit/job/failure summaries from existing audit events.
2. Add dry-run/preview for outgoing events.
3. Add retry/backoff only if scoped and tested.
4. Do not block core job execution on webhook failure unless configured.
5. Redact secrets in payloads and logs.

Acceptance for Phase 14:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
pnpm audit --audit-level high --registry https://registry.npmjs.org
git diff --check
```

Update `tasks/todo.md`: include operational evidence for schema compatibility, retention, dashboard smoke, and role/webhook behavior.

## v1.0 Work Breakdown

### Phase 9.1 - External Task Model

Goal: add a small internal model for external GitHub issue/PR task metadata without adding network writes yet.

Expected files:

- Likely `ai-system/types.ts`.
- Likely a new focused core module for parsing external task references.
- Focused tests under `tests/`.
- Update `tasks/todo.md`.

Content requirements:

- Distinguish `issue` and `pull_request`.
- Store provider, URL, owner/repo, numeric id, title when available, and source text.
- Keep metadata plain JSON-serializable.
- Do not contact GitHub yet unless the phase explicitly adds a connector/client.

Do not:

- Add OAuth, webhooks, or background polling.
- Persist secrets or tokens.
- Change existing run-state shapes without compatibility tests.

Verification:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Phase 9.2 - Manual GitHub Issue URL Intake

Goal: accept a GitHub Issue URL and normalize it into an internal task with explicit plan, risk, expected files, and test plan.

Expected focus:

- Prefer extending existing CLI/server task intake paths over creating a parallel flow.
- Keep initial version manual and deterministic.
- Include refusal/stop behavior when a URL is invalid or unsupported.

Expected files:

- CLI/server intake code only where already used for job creation.
- Tests for URL parsing and task normalization.
- Documentation update in `README.md` or `docs/OPERATIONS.md`.

Do not:

- Automatically comment on GitHub.
- Automatically change GitHub issue state.
- Fetch remote data without a clear config and tests.

Verification:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Phase 9.3 - Manual GitHub PR Review Intake

Goal: accept a GitHub PR URL and produce staff-level review output from local/diff context, with no implicit external update.

Expected behavior:

- Parse and persist PR metadata.
- Separate findings, open questions, test gaps, and summary.
- Require explicit approval before any future comment/status update.

Do not:

- Add webhook listeners.
- Add auto-merge or auto-approve behavior.
- Treat a remote PR URL as proof that local checkout matches the PR branch.

Verification:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Phase 9.4 - Persist External Task Metadata

Goal: persist external task metadata into run-state and artifact-index without breaking old artifacts.

Requirements:

- Add versioned plain-data fields only.
- Ensure old artifacts without external metadata still load.
- Add regression tests for old and new shapes.

Do not:

- Replace existing task strings with objects.
- Remove legacy readers.
- Store access tokens.

Verification:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Phase 9.5 - Approval-Gated External Updates

Goal: define the approval boundary for future GitHub comments/status updates before enabling real writes.

Requirements:

- External writes must be explicit actions, never side effects of planning/review.
- Persist who approved, what would be sent, and target URL.
- Dry-run output must show the exact planned external update.

Do not:

- Send comments/status updates by default.
- Add token requirements to normal local task runs.
- Hide external action previews inside generic logs.

Verification:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
git diff --check
```

## Completed v0.9 Reference

Phase 8 is complete. Keep these notes as historical reference only.

### Phase 8.1 - Internal Release Notes

Goal: summarize completed v0.2-v0.8 capabilities and migration notes.

Expected files:

- Add `docs/RELEASE_NOTES_v0.9.md`.
- Optionally link it from `README.md` or `docs/OPERATIONS.md`.
- Update `tasks/todo.md`.

### Phase 8.2 - Release Check / Doctor Extension

Goal: add or extend a command that validates release prerequisites.

### Phase 8.3 - Config Examples And Operator Runbook

Goal: make setup and operations clear for internal users.

### Phase 8.4 - One-Command Local Start Path

Goal: simplify starting the server and dashboard for local operators.

Do not:

- Add process managers or new dev dependencies just to run two commands.
- Hide required env vars.

Verification:

```bash
pnpm run typecheck
pnpm run lint
pnpm run dashboard:build
git diff --check
```

## Required Baseline Gates Before Completion

For code changes:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
pnpm audit --audit-level high --registry https://registry.npmjs.org
git diff --check
```

For docs-only changes:

```bash
git diff --check
pnpm run typecheck
```

If the docs change command examples or package scripts, also run the referenced command or explain why it was not run.

## Stop Conditions

Gemini must stop and report instead of continuing if:

- A required verification command fails twice for different reasons.
- A change requires new dependencies not listed in the phase.
- A serialized schema change is needed.
- Current working tree contains unrelated changes that conflict with the target files.
- The implementation would require touching more than five major modules for one phase.

## Gemini Prompt Template

Use this prompt when asking Gemini CLI to implement a phase:

```text
You are working in /Users/trungnghianguyen/Documents/AI-CODING-SYSTEM.

Implement only the selected roadmap sub-phase from tasks/gemini-cli-implementation-plan.md.

Selected phase: Phase __.__ - <paste exact phase title here>.

Do not work on later phases. Do not combine adjacent phases.

Read first:
- tasks/roadmap.md
- tasks/implementation-plan.md
- tasks/todo.md
- tasks/lessons.md
- docs/OPERATIONS.md
- README.md
- package.json

Guardrails:
- Do not batch-edit unrelated files.
- Do not use broad regex replacements.
- Preserve serialized JSON/artifact compatibility.
- Do not remove server lifecycle cleanup for timers, intervals, watchers, sockets, or background workers.
- If `pnpm test` hangs after assertions pass, inspect active handles/processes before weakening tests.
- Keep external GitHub writes, git commits, branch creation, PR creation, webhooks, and identity-provider changes behind explicit approval/preview unless the selected phase says otherwise.
- Follow existing import and test conventions.
- Update tasks/todo.md as progress changes.
- Run the required verification commands for the phase.

Output:
- Files changed.
- Verification commands and pass/fail result.
- Any remaining risk or blocker.
```

## Review Checklist For Gemini Output

Before accepting Gemini's changes, verify:

- The diff matches the selected phase only.
- No unrelated formatting churn occurred.
- No old docs now contradict the new docs.
- New commands in docs exist in `package.json` or CLI handlers.
- Tests were added for behavior changes.
- Full baseline gates pass when code changed.
- `tasks/todo.md` reflects actual completion, not aspirational completion.
