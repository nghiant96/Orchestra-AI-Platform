# Workspace CLI Implementation Plan

Last updated: 2026-05-02

This plan is the handoff guide for using Gemini CLI, DeepSeek, or another coding agent to implement the AI Software Workspace roadmap without drifting, over-editing, or breaking the current green baseline.

## Current Target

Convert the current system into an AI Software Workspace by adding a durable Work Item layer above the existing run/orchestrator/artifact flow.

Do not rewrite the orchestrator.

Implement phases in this order:

1. Phase W0 - Workspace Baseline And Compatibility.
2. Phase W1 - Work Item v1 Data Model And Store.
3. Phase W2 - Assessment Engine.
4. Phase W3 - Task Graph And Evidence Checklist.
5. Phase W4 - Work Engine Integration With Orchestrator.
6. Phase W5 - Workspace API And Dashboard Work Board.
7. Phase W6 - Branch And Worktree Automation.
8. Phase W7 - Commit And PR Automation.
9. Phase W8 - CI Feedback Loop.
10. Phase W9 - Inbox Integrations.
11. Phase W10 - Parallel Workspace Execution.
12. Phase W11 - Team Governance And Productization.

Do not start a later phase until the previous phase acceptance is complete and all required gates are green.

## Required Context To Read First

The agent must read these files before editing:

1. `tasks/workspace-roadmap.md`
2. `tasks/gemini-cli-implementation-plan.md`
3. `tasks/roadmap.md`
4. `tasks/implementation-plan.md`
5. `tasks/todo.md`
6. `tasks/lessons.md`
7. `docs/OPERATIONS.md`
8. `README.md`
9. `package.json`
10. Relevant implementation files only after the target phase is chosen.

The agent must not infer status from memory, prior chats, or old roadmap text. The source of truth is the files above plus current command output.

## Non-Negotiable Guardrails

- Do not rewrite or bypass `ai-system/core/orchestrator.ts`, `run-executor.ts`, or existing artifact loading.
- Work Items sit above existing Jobs/Runs. They reference run IDs and artifacts instead of copying full run state.
- Old `.ai-system-artifacts/run-*` artifacts must remain readable without a Work Item.
- Do not change persisted JSON shapes without normalizers and backward-compatibility tests.
- Do not use broad regex or bulk replacements across the repo.
- Do not edit unrelated files while completing a phase.
- Do not add new frameworks, databases, queues, auth providers, or package dependencies unless the current phase explicitly requires them.
- Git writes, branch creation, artifact apply, staging, commits, pushes, PR creation, external comments, and external status updates must be approval-gated.
- GitHub/Jira/Trello/network writes must start as dry-run previews unless explicitly approved.
- Required checklist items cannot become `passed` without evidence.
- Waiving a required checklist item requires actor, reason, timestamp, and audit event.
- Timers, intervals, watchers, sockets, and background workers must be disposed on close or use `unref()` where appropriate.
- If tests fail, investigate root cause instead of weakening assertions.
- Update `tasks/todo.md` after each sub-phase actually completes.

## Known Lessons To Respect

From `tasks/lessons.md`:

- Never batch-modify files outside scope.
- Serialized data must stay plain JSON data, not class instances or method-bearing objects.
- Follow existing import conventions, especially `node:` imports in backend code.
- Server background resources must not outlive tests.

From the Phase 9-14 work:

- Preserve compatibility for run-state and artifact-index normalizers.
- PR/review flows must be evidence-grounded and review-first for PR URLs.
- Refactor rollback notes must not suggest destructive git commands.
- Webhook/export previews must redact nested secrets.
- Dashboard changes require dashboard build and dashboard tests.

## Universal Preflight Before Any Phase

Run/read:

```bash
git status --short
sed -n '1,260p' tasks/workspace-roadmap.md
sed -n '1,220p' tasks/todo.md
sed -n '1,220p' tasks/lessons.md
```

Search only the files needed for the selected phase:

```bash
rg -n "WorkItem|work item|run-state|artifact-index|PersistedRunState|QueueJob|createAiSystemServer|POST.*jobs|readJsonBody" ai-system tests dashboard/src
rg -n "risk-policy|TaskContract|checklist|evidence|approval|audit|externalTask|git-workflow" ai-system tests dashboard/src
rg -n "worktree|branch|commit|pull request|gh pr|webhook|stats|analytics" ai-system tests dashboard/src README.md docs tasks
```

Rules:

- If `git status --short` shows unrelated user edits in target files, stop and report the conflict.
- If the selected phase touches server code, run `tests/server-queue.test.ts` before the full test suite.
- If the selected phase touches artifact/run-state/work-item shape, add normalizer tests.
- If the selected phase touches dashboard code, run dashboard build and tests.
- If a phase requires external writes, implement preview/approval first and stop before real writes.

## Verification Gates

Every phase with code changes must pass:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
git diff --check
```

If dashboard code changes:

```bash
pnpm run dashboard:build
pnpm --dir dashboard test
```

If Git/GitHub behavior changes:

```bash
pnpm exec node --import tsx --test tests/git-workflow.test.ts
```

If server/workspace API changes:

```bash
pnpm exec node --import tsx --test tests/server-queue.test.ts
```

If only docs/tasks change:

```bash
git diff --check
```

## Phase W0 Playbook - Workspace Baseline And Compatibility

Goal: establish the workspace direction without destabilizing current task/run flows.

Expected files:

- `docs/WORKSPACE.md`
- `tasks/todo.md`
- Optional: `tests/workspace-baseline.test.ts`

Checklist:

- [ ] Read `tasks/workspace-roadmap.md` and identify final domain terms.
- [ ] Document the difference between Workspace, Project, Job, Run, Work Item, Artifact, Checklist, and Evidence.
- [ ] Document artifact coexistence: old runs remain under `.ai-system-artifacts/run-*`; work items will live under `.ai-system-artifacts/work-items/<work-id>/`.
- [ ] Document migration rule: existing run artifacts do not require work item backfill.
- [ ] Add smoke coverage only if the existing tests do not already cover job/stats/audit compatibility.
- [ ] Confirm current `POST /jobs`, `/jobs`, `/stats`, `/audit`, and dashboard behavior remains unchanged.
- [ ] Update `tasks/todo.md` with W0 completion notes.

Do not:

- [ ] Do not create the full Work Item store in W0.
- [ ] Do not modify orchestrator execution flow.
- [ ] Do not rename Jobs or Runs in public API.

Acceptance:

- [ ] Workspace glossary exists.
- [ ] Old run/job semantics remain unchanged.
- [ ] Required gates pass.

## Phase W1 Playbook - Work Item v1 Data Model And Store

Goal: create durable Work Items independent from a single run.

Expected files:

- `ai-system/work/work-item.ts`
- `ai-system/work/work-store.ts`
- `ai-system/work/normalizers.ts`
- `ai-system/work/index.ts`
- `tests/work-item-store.test.ts`
- CLI integration in `ai-system/cli.ts` or focused handler files.

Suggested artifact layout:

```text
.ai-system-artifacts/work-items/<work-id>/
  work-item.json
  assessment.json
  task-graph.json
  checklist.json
  runs.json
```

Checklist:

- [ ] Define plain JSON types: `WorkItem`, `WorkItemSource`, `WorkItemType`, `WorkItemStatus`, `ExpectedOutput`.
- [ ] Define reusable types: `TaskAssessment`, `ExecutionGraph`, `ExecutionGraphNode`, `ExecutionGraphEdge`, `ChecklistItem`, `EvidenceRef`.
- [ ] Add `schemaVersion` to each persisted workspace JSON file.
- [ ] Add normalizers for missing/old fields.
- [ ] Add ID generation that is stable, filesystem-safe, and traceable.
- [ ] Add file-backed create/load/list/update APIs.
- [ ] Add `runs.json` as a link table, not a copy of run-state.
- [ ] Add CLI commands: `ai work create`, `ai work list`, `ai work show`.
- [ ] Ensure Work Item creation does not start an orchestrator run.
- [ ] Add tests for create/list/show/load/normalize/missing fields.
- [ ] Update `tasks/todo.md` with W1 completion notes.

Do not:

- [ ] Do not duplicate full run-state into work item files.
- [ ] Do not require all old run artifacts to have work items.
- [ ] Do not add dashboard UI yet unless W1 is already green.

Acceptance:

- [ ] Work items can be created, listed, loaded, and normalized.
- [ ] Work items persist under `.ai-system-artifacts/work-items`.
- [ ] Old run artifacts still load.
- [ ] Required gates pass.

## Phase W2 Playbook - Assessment Engine

Goal: turn raw task text into structured assessment before implementation.

Expected files:

- `ai-system/work/assessment.ts`
- `tests/work-assessment.test.ts`
- CLI updates for `ai work assess` and `ai work create --assess`.

Checklist:

- [ ] Add deterministic signals for auth, payment, security, migration, deployment, config/env/secrets, dependency/lockfile, broad refactor, external issue/PR, and expected output.
- [ ] Reuse existing risk policy instead of inventing a second risk system.
- [ ] Produce `complexity`, `risk`, `confidence`, `affectedAreas`, `requiresBranch`, `requiresHumanApproval`, `requiresFullTestSuite`, `reason`, and `signals`.
- [ ] Persist `assessment.json`.
- [ ] Add CLI display with concise reasons and next recommended action.
- [ ] Add optional LLM-assisted assessment only behind schema validation and deterministic fallback.
- [ ] Add tests for low, medium, high, blocked, external PR review, and secret/config cases.
- [ ] Update `tasks/todo.md` with W2 completion notes.

Do not:

- [ ] Do not write code or run implementation during assessment.
- [ ] Do not let LLM assessment override deterministic blocked/high-risk signals without validation.
- [ ] Do not hide why a risk level was assigned.

Acceptance:

- [ ] Assessment is explainable and persisted.
- [ ] Assessment can require approval before later write/branch actions.
- [ ] Required gates pass.

## Phase W3 Playbook - Task Graph And Evidence Checklist

Goal: decompose work into an execution graph and enforce evidence-backed checklist completion.

Expected files:

- `ai-system/work/task-graph.ts`
- `ai-system/work/checklist.ts`
- `ai-system/work/evidence.ts`
- `tests/work-task-graph.test.ts`
- `tests/work-checklist.test.ts`

Checklist:

- [ ] Add graph node kinds: inspect, test, implement, check, review, commit, pr, ci_fix.
- [ ] Add edge kinds: dependency, blocker, validation.
- [ ] Add default templates for bugfix, feature, refactor, review, and CI failure.
- [ ] Generate checklist items from graph nodes, assessment, and Task Contracts.
- [ ] Add evidence refs for file, check, artifact, run, commit, PR, review, approval, and audit event.
- [ ] Validate file evidence exists.
- [ ] Validate check evidence exists and passed.
- [ ] Validate run artifact evidence exists.
- [ ] Validate commit/PR/approval/audit evidence has required metadata.
- [ ] Block `passed` for required checklist items without evidence.
- [ ] Require reason and actor for waived required items.
- [ ] Update `tasks/todo.md` with W3 completion notes.

Do not:

- [ ] Do not make checklist state a free-form string.
- [ ] Do not allow AI claims to count as evidence unless tied to a run/review artifact.
- [ ] Do not implement parallel execution yet.

Acceptance:

- [ ] Bugfix tasks generate inspect/test/implement/check/review/PR nodes.
- [ ] Checklist progress is evidence-backed.
- [ ] Required waivers are auditable.
- [ ] Required gates pass.

## Phase W4 Playbook - Work Engine Integration With Orchestrator

Goal: execute work graph nodes through existing orchestrator runs.

Expected files:

- `ai-system/work/work-engine.ts`
- `ai-system/work/state-machine.ts`
- `tests/work-engine.test.ts`
- CLI commands for `ai work run`, `ai work resume`, `ai work retry`.

Checklist:

- [ ] Map execution graph nodes to existing orchestrator task prompts.
- [ ] Link each executed node to one or more run IDs.
- [ ] Persist node status from run result.
- [ ] Attach evidence after checks, review, approval, or artifact generation.
- [ ] Reuse existing approval policy and confirmation checkpoints.
- [ ] Add dry-run mode that shows planned node execution without starting runs.
- [ ] Add resume work item behavior.
- [ ] Add retry failed node behavior.
- [ ] Add work-item-level failure classification from linked run failures.
- [ ] Add tests with mocked run execution where possible.
- [ ] Update `tasks/todo.md` with W4 completion notes.

Do not:

- [ ] Do not duplicate generator/fixer/reviewer logic in Work Engine.
- [ ] Do not skip existing risk/approval gates.
- [ ] Do not execute all graph nodes if a dependency failed.

Acceptance:

- [ ] A work item can run at least one orchestrator-backed node.
- [ ] Work item status follows linked run status.
- [ ] Evidence is attached after completed checks/review.
- [ ] Required gates pass.

## Phase W5 Playbook - Workspace API And Dashboard Work Board

Goal: make Work Items visible and operable in the server and dashboard.

Expected files:

- Server route changes in `ai-system/server-app.ts` or extracted route modules.
- Dashboard hooks such as `dashboard/src/hooks/useWorkItems.ts`.
- Dashboard components for Inbox, Work Board, and Work Item Detail.
- Tests under `tests/` and `dashboard/src/test` or component test folders.

Checklist:

- [ ] Add server routes: `GET /work-items`, `POST /work-items`, `GET /work-items/:id`.
- [ ] Add action routes: `POST /work-items/:id/assess`, `run`, `cancel`, `retry`.
- [ ] Validate request bodies with the repo's existing schema style.
- [ ] Return normalized public payloads with schema versions where relevant.
- [ ] Add dashboard Work Board without removing current job feed.
- [ ] Add Work Item Detail sections: assessment, graph, checklist, linked runs, branch/PR, checks, audit.
- [ ] Add loading, empty, error, and action-in-progress states.
- [ ] Keep dashboard UI dense and operational, not marketing-like.
- [ ] Add server and dashboard smoke tests.
- [ ] Update `tasks/todo.md` with W5 completion notes.

Do not:

- [ ] Do not bury or remove current Jobs/Runs views.
- [ ] Do not create nested card-heavy layouts.
- [ ] Do not add a separate frontend state library unless already used.

Acceptance:

- [ ] User can create and inspect a work item from dashboard.
- [ ] Dashboard shows checklist progress and evidence.
- [ ] Job/run views still work.
- [ ] Server and dashboard gates pass.

## Phase W6 Playbook - Branch And Worktree Automation

Goal: isolate work items into branch/worktree execution environments.

Expected files:

- `ai-system/git/branch-manager.ts`
- `ai-system/git/worktree-manager.ts`
- `ai-system/git/diff-manager.ts`
- Tests with a temporary git repository.

Checklist:

- [ ] Reuse `ai-system/core/git-workflow.ts` helpers where possible.
- [ ] Add safe branch name generation from work item metadata.
- [ ] Add dirty-worktree detection before branch/worktree action.
- [ ] Add approval boundary before branch creation.
- [ ] Add optional `git worktree` create/list/remove metadata flow.
- [ ] Persist branch/worktree metadata on the Work Item.
- [ ] Add cleanup/retain policy but make destructive cleanup approval-gated.
- [ ] Detect unrelated local changes and stop.
- [ ] Add CLI commands: `ai work branch`, `ai work worktree create`.
- [ ] Update `tasks/todo.md` with W6 completion notes.

Do not:

- [ ] Do not run destructive git commands automatically.
- [ ] Do not switch branches if the working tree is dirty.
- [ ] Do not assume the user wants a worktree for every work item.

Acceptance:

- [ ] Branch names are safe and traceable.
- [ ] Work item branch/worktree metadata is persisted.
- [ ] Unrelated working tree changes are protected.
- [ ] Git-focused tests and required gates pass.

## Phase W7 Playbook - Commit And PR Automation

Goal: turn completed work items into reviewable PRs with high-quality evidence.

Expected files:

- `ai-system/git/commit-manager.ts`
- `ai-system/github/github-cli.ts`
- `ai-system/github/pr-client.ts`
- Tests for preview and approval behavior.

Checklist:

- [ ] Add approval-gated artifact apply/stage/commit path for work items.
- [ ] Generate commit message from Work Item, assessment, checklist, changed files, and checks.
- [ ] Generate PR body from verified evidence only.
- [ ] Include summary, assessment, plan/checklist, files changed, checks, review notes, risks, artifacts, and rollback section.
- [ ] Add `ai work commit`, `ai work pr preview`, `ai work pr create`.
- [ ] Make `gh` CLI operations preview-first.
- [ ] Persist PR metadata after creation.
- [ ] Add audit events for apply/stage/commit/PR actions.
- [ ] Add tests that prove PR creation cannot happen without approval.
- [ ] Update `tasks/todo.md` with W7 completion notes.

Do not:

- [ ] Do not invent checks, files, risk status, or review results.
- [ ] Do not push directly to protected branches by default.
- [ ] Do not perform network writes in tests.

Acceptance:

- [ ] PR body is grounded in evidence.
- [ ] PR creation never happens without explicit approval.
- [ ] GitHub interactions support dry-run preview.
- [ ] Required gates pass.

## Phase W8 Playbook - CI Feedback Loop

Goal: watch PR checks and create follow-up fixes when CI fails.

Expected files:

- `ai-system/github/checks-client.ts`
- `ai-system/work/ci-feedback.ts`
- Tests for normalized check output and repair limits.

Checklist:

- [ ] Add CI check collector using `gh pr checks` first.
- [ ] Normalize success, pending, failed, skipped, cancelled, and unknown statuses.
- [ ] Convert failed checks into structured fix tasks linked to the same Work Item.
- [ ] Link CI repair runs to the same branch/PR.
- [ ] Add loop limits for attempts, cost, duration, and repeated failure class.
- [ ] Add `ai work ci watch`, `ai work ci fix`, and optional `ai fix-ci --pr`.
- [ ] Persist final CI status and residual-risk report.
- [ ] Add tests with fixture `gh` output.
- [ ] Update `tasks/todo.md` with W8 completion notes.

Do not:

- [ ] Do not poll forever.
- [ ] Do not create infinite fix loops.
- [ ] Do not treat pending CI as passed.

Acceptance:

- [ ] CI failure can produce a structured repair task.
- [ ] Fix runs stay linked to the same work item and branch.
- [ ] System stops at configured limits.
- [ ] Required gates pass.

## Phase W9 Playbook - Inbox Integrations

Goal: bring external work into the workspace.

Expected files:

- `ai-system/workspace/inbox.ts`
- `ai-system/github/issue-client.ts`
- `ai-system/github/review-comments.ts`
- Optional API/webhook route additions.

Checklist:

- [ ] Convert GitHub Issue URLs into Work Items.
- [ ] Convert GitHub PR URLs into review Work Items.
- [ ] Convert CI failures into Work Items.
- [ ] Add API/webhook intake using existing webhook redaction rules.
- [ ] Add deduplication by provider, owner/repo, kind, and external ID/URL.
- [ ] Add Inbox status: new, accepted, rejected, duplicate, archived.
- [ ] Require human approval or explicit policy before imported work executes.
- [ ] Add CLI commands: `ai work from-issue`, `ai work from-pr`, `ai work inbox sync`.
- [ ] Add tests for dedupe, invalid URLs, PR review mode, and dry-run import.
- [ ] Update `tasks/todo.md` with W9 completion notes.

Do not:

- [ ] Do not start Jira/Trello until GitHub/API intake is stable.
- [ ] Do not execute imported work automatically unless policy explicitly permits it.
- [ ] Do not store raw secrets from webhook payloads.

Acceptance:

- [ ] External work appears in Inbox without manual context copying.
- [ ] Duplicate external items do not create duplicate active work.
- [ ] Imported work is not executed until policy permits it.
- [ ] Required gates pass.

## Phase W10 Playbook - Parallel Workspace Execution

Goal: run multiple work items safely.

Expected files:

- `ai-system/workspace/work-board.ts`
- `ai-system/workspace/scheduler.ts`
- `ai-system/workspace/conflicts.ts`
- Tests for scheduler and conflict detection.

Checklist:

- [ ] Require branch/worktree isolation for concurrent write execution.
- [ ] Add per-project concurrency limits.
- [ ] Add dependency graph between work items.
- [ ] Detect overlapping file scopes before parallel execution.
- [ ] Block or isolate conflicting work items.
- [ ] Add pause/resume/cancel per work item.
- [ ] Add dashboard visibility for active workspaces/worktrees.
- [ ] Add cleanup policy for old worktrees.
- [ ] Add tests for no-conflict, conflict, dependency-blocked, and cancellation cases.
- [ ] Update `tasks/todo.md` with W10 completion notes.

Do not:

- [ ] Do not run multiple write tasks in the same working tree.
- [ ] Do not ignore file-scope conflicts just because branches differ.
- [ ] Do not auto-delete worktrees without approval or retention policy.

Acceptance:

- [ ] Multiple work items can run without touching the same working tree.
- [ ] Conflicts are detected before execution.
- [ ] Operators can pause/resume/cancel per work item.
- [ ] Required gates pass.

## Phase W11 Playbook - Team Governance And Productization

Goal: mature the workspace for team usage.

Expected files:

- `ai-system/policy/action-permissions.ts`
- `ai-system/workspace/notifications.ts`
- `ai-system/workspace/workspace-api.ts`
- Analytics/dashboard updates.

Checklist:

- [ ] Define action permissions for assess, plan, write, branch, commit, PR, external comment, and merge.
- [ ] Add project-level permission rules while preserving local token/header mode.
- [ ] Add notification center or notification export hooks.
- [ ] Add audit export.
- [ ] Add workspace analytics: cycle time, PR success rate, CI repair rate, repeated failure classes, checklist completion quality.
- [ ] Add retention/migration docs for workspace artifacts.
- [ ] Add tests for permission decisions and audit trail completeness.
- [ ] Update dashboard analytics without breaking existing stats.
- [ ] Update `docs/OPERATIONS.md` with operating procedures.
- [ ] Update `tasks/todo.md` with W11 completion notes.

Do not:

- [ ] Do not add a full enterprise auth system unless requested.
- [ ] Do not remove local token/header mode.
- [ ] Do not make governance checks advisory only for risky actions.

Acceptance:

- [ ] Team can answer who approved what, when, and why.
- [ ] Workspace supports multiple projects and operators cleanly.
- [ ] Artifacts remain readable across schema versions.
- [ ] Required gates pass.

## Stop Conditions

Stop and report instead of continuing when:

- A target file has unrelated user changes that make the phase ambiguous.
- A persisted schema change would break existing artifacts and no migration path is clear.
- A command needs external network writes or destructive git actions without approval.
- Tests hang after assertions pass; inspect server resources/timers before modifying tests.
- A phase requires a new dependency but the same goal can be met with existing code.
- The implementation starts rewriting orchestrator/generator/fixer/reviewer instead of adding workspace orchestration.

## Prompt Template For Gemini Or DeepSeek

Use this prompt when assigning one phase:

```text
You are implementing Phase W<NUMBER> from tasks/workspace-cli-implementation-plan.md.

Read first:
- tasks/workspace-roadmap.md
- tasks/workspace-cli-implementation-plan.md
- tasks/todo.md
- tasks/lessons.md
- package.json
- only the relevant source files for this phase

Rules:
- Implement only Phase W<NUMBER>.
- Do not edit unrelated files.
- Do not rewrite the existing orchestrator.
- Preserve old run/artifact compatibility.
- Add tests for new behavior and normalizers.
- Update tasks/todo.md only for completed W<NUMBER> work.
- Run the required verification gates from the plan.

Before coding, print the exact files you expect to touch and the acceptance checklist.
After coding, report changed files, tests run, and any remaining risks.
```

## Review Checklist For Agent Output

Use this checklist before accepting a Gemini/DeepSeek patch:

- [ ] Did it implement only the assigned phase?
- [ ] Did it preserve existing CLI/server/dashboard behavior?
- [ ] Did it avoid broad regex and unrelated churn?
- [ ] Did persisted JSON changes include normalizers and tests?
- [ ] Did Work Item state reference runs instead of duplicating full run-state?
- [ ] Did required checklist state require evidence?
- [ ] Did risky actions require approval?
- [ ] Did server resources clean up correctly?
- [ ] Did dashboard changes pass dashboard build/test?
- [ ] Did all required gates pass?
- [ ] Did `tasks/todo.md` reflect only completed work?

