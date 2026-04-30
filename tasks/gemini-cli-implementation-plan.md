# Gemini CLI Implementation Plan

Last updated: 2026-04-30

This plan is the handoff guide for using Gemini CLI to implement the next roadmap work without drifting, over-editing, or breaking the current green baseline.

## Current Target

Implement `v0.9 - Release Candidate Packaging` first.

Do not start v1.0 observability, v1.1 contract intelligence, v1.2 dashboard automation, or v1.3 team integrations until v0.9 acceptance is complete and all baseline gates are green.

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

## Known Lessons Gemini Must Respect

From `tasks/lessons.md`:

- Never batch-modify files outside scope.
- `ProviderSummary` is serialized data. Do not change it into class instances or method-bearing objects.
- Match existing import conventions.
- In environments with a required completion tool, use that tool. In this repo workflow, update task docs and provide a concise completion summary.

## v0.9 Work Breakdown

### Phase 8.1 - Internal Release Notes

Goal: summarize completed v0.2-v0.8 capabilities and migration notes.

Expected files:

- Add `docs/RELEASE_NOTES_v0.9.md`.
- Optionally link it from `README.md` or `docs/OPERATIONS.md`.
- Update `tasks/todo.md`.

Content requirements:

- Completed capabilities by milestone: v0.2, v0.2.5, v0.3, v0.4, v0.5, v0.6, v0.7, v0.8.
- Migration notes for config, approval policy, failure class naming, artifacts, dashboard component cleanup, and server operations.
- Known non-blocking limitations: no browser-level dashboard smoke yet, identity provider integration not yet implemented, schema versioning planned for v1.0.
- Verification checklist.

Do not:

- Invent release claims that are not backed by current code/tests/docs.
- Change runtime code in this phase unless a doc command is wrong and must be fixed.

Verification:

```bash
git diff --check
pnpm run typecheck
```

### Phase 8.2 - Release Check / Doctor Extension

Goal: add or extend a command that validates release prerequisites.

Expected focus:

- Inspect existing `ai doctor`, `ai setup --check`, and config workflow code before adding anything new.
- Prefer extending existing doctor/setup-check behavior over creating a parallel command.

Minimum checks:

- Node version is present and supported.
- `pnpm` is available.
- `gemini` CLI availability for planner/reviewer defaults.
- `codex` CLI availability for generator/fixer defaults, when configured.
- Project `.ai-system.json` is readable when present.
- Effective provider config is explainable.
- Server token is set when server mode is requested.
- Allowed workdirs are absolute and exist.
- Dashboard build command exists and can be run or is documented as a manual gate.

Expected files:

- Likely `ai-system/cli/handlers/config-handler.ts`, `ai-system/core/config-workflow.ts`, or related formatter files.
- Tests under `tests/config-workflow.test.ts`, CLI handler tests, or a new focused test file if existing coverage is not appropriate.
- Docs update in `docs/OPERATIONS.md` and/or README.

Do not:

- Shell out to expensive build/test commands inside a fast doctor check unless explicitly requested.
- Require provider CLIs that are not configured.
- Fail local CLI mode because optional server env vars are absent.

Verification:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

### Phase 8.3 - Config Examples And Operator Runbook

Goal: make setup and operations clear for internal users.

Expected files:

- README sections for setup paths if outdated.
- `docs/OPERATIONS.md` runbook expansion.
- Optional example configs if the repo already has example config conventions.

Required runbook sections:

- Local CLI mode.
- Hybrid provider mode.
- 9router mode.
- Server/dashboard mode.
- Queue recovery.
- Artifact cleanup.
- Audit review.
- Lessons workflow.
- Common failures and next action.

Do not:

- Duplicate large README sections verbatim into operations docs.
- Document commands that do not exist.
- Put secrets into examples.

Verification:

```bash
git diff --check
pnpm run typecheck
```

### Phase 8.4 - One-Command Local Start Path

Goal: simplify starting the server and dashboard for local operators.

Preferred approach:

- Add package scripts only if they are simple and cross-platform enough for the current shell assumptions.
- If one command is not clean, document a script pair instead.

Possible scripts:

- `server` already exists.
- `dashboard:dev` already exists.
- A combined command may require a new dependency; avoid that unless approved.

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

Implement only Phase 8.X from tasks/gemini-cli-implementation-plan.md.

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
