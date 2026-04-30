# Roadmap Implementation Plan

Last updated: 2026-04-30

This plan breaks the roadmap into concrete implementation phases. Each phase should leave the repository with passing baseline gates:

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`
- `pnpm run dashboard:build`
- `pnpm audit --audit-level high --registry https://registry.npmjs.org`
- `git diff --check`

## Phase 0 - Documentation And Source Cleanup

Status: completed

Goal: keep one source of truth for roadmap and execution planning.

Tasks:

- [x] Keep `tasks/roadmap.md` as the only roadmap document.
- [x] Keep `tasks/implementation-plan.md` as the detailed execution plan.
- [x] Keep `tasks/todo.md` for active task checklists and completion records only.
- [x] Remove obsolete review and roadmap documents from root and `tasks/`.
- [x] Preserve `tasks/lessons.md` as the project learning log.

Acceptance:

- No stale `Review*.md`, `project_review.md`, or old roadmap files remain.
- New work references `tasks/roadmap.md` and `tasks/implementation-plan.md`.

## Phase 1 - v0.2 Green Operations Baseline

Status: completed

Goal: make queue, server, dashboard, and checks predictable for daily internal use.

### 1.1 Queue And Approval Semantics

Tasks:

- [x] Treat `skip_approval=true` as auto-run for queue jobs.
- [x] Keep manual approval as default when `skip_approval` is absent or false.
- [x] Show approval mode in job detail and health responses.
- [x] Add tests for auto-run and manual approval queue jobs.
- [x] Ensure cancel, retry, resume, and clear-finished preserve consistent job status.

Acceptance:

- Queue jobs do not get stuck waiting for approval when auto-run is configured.
- Manual approval jobs visibly wait with a pending plan.

### 1.2 Queue Lifecycle Reliability

Tasks:

- [x] Add graceful queue shutdown and active job draining.
- [x] Ensure server close does not race active job writes.
- [x] Ensure tests wait for terminal job states before temp cleanup.
- [x] Add regression tests for cancel and shutdown behavior.

Acceptance:

- Full `pnpm test` has zero failures.
- `tests/server-queue.test.ts` passes reliably in isolation and in full suite.

### 1.3 Dashboard Operations UX

Tasks:

- [x] Rework Job Detail into sections: Summary, Plan, Contract, Checks, Review, Artifacts, Retry.
- [x] Show failure class and retry hint prominently.
- [x] Add explicit approve/reject/retry/resume actions with disabled/loading states.
- [x] Keep Event Feed filters wrapped and count-aware.

Acceptance:

- A user can inspect a failed job and know the next action without terminal logs.

## Phase 1.5 - v0.2.5 Dashboard Polish

Status: completed

Goal: make the existing dashboard easier to operate and easier to maintain before adding Task Contracts.

### 1.5.1 Job Detail Decomposition

Tasks:

- [x] Split Job Detail into section components: Summary, Plan, Checks, Review, Artifacts, Retry, and Contract placeholder.
- [x] Keep the existing modal API stable for callers.
- [x] Add tests or type-level coverage for job states: queued, running, waiting for approval, failed, completed, cancelled.

Acceptance:

- Job Detail changes no longer require editing a single large component.
- Failed jobs show the full execution story in a predictable order.

### 1.5.2 Failure And Retry UX

Tasks:

- [x] Expand FailurePanel to show failure class, retryable flag, retry hint stage, reason, and suggested action.
- [x] Add disabled/loading states for approve, reject, retry, resume, and cancel actions.
- [x] Show when an action is unavailable and why.

Acceptance:

- A user can decide whether to retry, resume, inspect artifacts, or edit config from the dashboard.

### 1.5.3 Config View Decomposition

Tasks:

- [x] Split Config View into smaller panels: Approval, Budgets, Providers, Routing, Memory, Tools.
- [x] Preserve the existing form data shape.
- [x] Keep save behavior unchanged.

Acceptance:

- Config policy changes can be reviewed and tested independently by panel.

### 1.5.4 Project Health

Tasks:

- [x] Add a Project Health panel showing last known typecheck, lint, test, dashboard build, and audit status when available.
- [x] Reuse artifact or stats data instead of inventing a new storage layer in this phase.

Acceptance:

- The dashboard can answer whether the project baseline is currently healthy.

### 1.4 Quality Gate Policy

Tasks:

- [x] Use package-scoped lint/typecheck/build when all changed files are inside one package.
- [x] Run dashboard build for dashboard changes when build checks are enabled.
- [x] Add focused tests for package build scoping.
- [x] Document the recommended safe profile checks.

Acceptance:

- Dashboard changes run dashboard checks, not unrelated root checks.
- System changes can opt into focused test checks without forcing full tests for every task.

## Phase 2 - v0.3 Task Contracts

Status: completed

Goal: turn user intent into explicit requirements that can be checked.

### 2.1 Contract Model

Tasks:

- [x] Add a `TaskContract` type with id, description, severity, check strategy, and status.
- [x] Add migration wrappers so current Event Feed requirement checks can emit `TaskContract` items without behavior loss.
- [x] Store contracts in plan artifacts.
- [x] Include contracts in generator, reviewer, and fixer prompts.
- [x] Add contract results to iteration artifacts.

Acceptance:

- Every generated candidate can be evaluated against the same contract.

### 2.2 Contract Extraction

Tasks:

- [x] Extract UI layout contracts from task text.
- [x] Extract API/schema preservation contracts.
- [x] Extract test-required contracts for risky areas.
- [x] Extract security/dependency contracts.
- [x] Keep extraction deterministic first; add LLM-assisted extraction only after deterministic rules are stable.

Acceptance:

- Common UI, API, config, and dependency tasks produce useful contract items.

### 2.3 Contract Validation

Tasks:

- [x] Move existing Event Feed requirement guards into the generic contract system.
- [x] Preserve current Event Feed tests as regression tests during migration.
- [x] Fail candidates that miss medium/high contract requirements.
- [x] Feed contract failures into fixer iterations.
- [x] Add tests for pass/fail contract scenarios.

Acceptance:

- Missing requirements are caught before write.

### 2.4 Dashboard Contract Visibility

Tasks:

- [x] Show contract list in Job Detail.
- [x] Show pass/fail/unknown status per contract.
- [x] Link failed contracts to suggested fixes when available.

Acceptance:

- Users can see exactly which requested requirements were satisfied.

## Phase 3 - v0.4 Policy-Based Automation

Status: completed

Goal: choose approval and verification behavior based on task risk.

### 3.1 Risk Scoring

Tasks:

- [x] Add risk signals for path sensitivity, diff size, dependency files, auth/payment areas, migrations, and generated file count.
- [x] Produce a risk score and risk class: low, medium, high, blocked.
- [x] Persist policy decisions in artifacts.

Acceptance:

- Every job has an explainable risk class.

### 3.2 Policy Actions

Tasks:

- [x] Low risk: auto-run with standard checks.
- [x] Medium risk: pause after plan.
- [x] High risk: pause after generate and use strict review.
- [x] Blocked: require explicit manual approval before write.

Acceptance:

- Approval behavior follows policy unless explicitly overridden.

### 3.3 Dashboard Policy Explanation

Tasks:

- [x] Show risk class and matched signals in Job Detail.
- [x] Show why a job required approval.
- [x] Show policy override source when applicable.

Acceptance:

- Users understand why a job did or did not pause.

## Phase 4 - v0.5 Productized Dashboard

Status: completed

Goal: make dashboard the primary operations surface.

Tasks:

- [x] Activity Feed: recent jobs/runs, filters, counts, live status.
- [x] Job Detail: full execution story and actions.
- [x] Project Health: latest baseline gate status.
- [x] Provider Performance: success rate, duration, cost, failure rate.
- [x] Cost & Budget: daily/project trends and limits.
- [x] Config Policy: safe editing for approval, budgets, routing, memory, and checks.

Acceptance:

- A user can operate common workflows without reading terminal output.

## Phase 5 - v0.6 Multi-Project And Team Readiness

Status: completed

Goal: support multiple repositories and operators safely.

Tasks:

- [x] Add project registry.
- [x] Add per-project queues and artifacts.
- [x] Add role model: viewer, operator, admin.
- [x] Add approval and config permissions.
- [x] Add audit log for job creation, approval, writes, provider usage, and checks.

Acceptance:

- Multiple projects can run without mixing jobs, artifacts, or configuration.

## Phase 6 - v0.7 Learning System

Status: completed

Goal: improve behavior from prior executions and corrections.

Tasks:

- [x] Convert recurring failures into proposed contract rules.
- [x] Store user corrections in `tasks/lessons.md` or project memory.
- [x] Inject relevant lessons into planning.
- [x] Track provider quality, latency, and cost over time.
- [x] Surface memory and lessons in dashboard.

Acceptance:

- The same requirement miss becomes less likely after correction.

## Phase 7 - v0.8 Stabilization And Release Hardening

Status: completed

Goal: turn the completed roadmap implementation into a maintainable internal release candidate.

Tasks:

- [x] Remove stale review and roadmap assessment documents that no longer match the green baseline.
- [x] Remove unused duplicate dashboard component trees so there is one canonical component surface.
- [x] Add API and operations documentation for queue, approval policy, artifacts, audit, lessons, and project selection endpoints.
- [x] Add an end-to-end smoke checklist for running the server and dashboard against real artifacts.
- [x] Add automated server smoke coverage for health, projects, jobs, stats, lessons, and audit.
- [x] Normalize newly emitted failure classes to kebab-case while preserving legacy artifact compatibility.
- [x] Split high-churn server, tool adapter, and dashboard view code into smaller modules.
- [x] Keep all baseline gates green after cleanup.

Acceptance:

- The repository no longer contains stale guidance that contradicts current behavior.
- Dashboard components have one active implementation path.
- A new operator can run the platform and understand the primary server/dashboard workflows without reading source code.

## Immediate Next Sprint

Recommended order:

1. Prepare an internal release note from the completed v0.2-v0.8 roadmap.
2. Add browser-level dashboard smoke automation if the dashboard becomes a release-critical surface.
3. Continue reducing the largest core modules when touching them for feature work.

## Phase 8 - v0.9 Release Candidate Packaging

Status: completed

Goal: make the platform installable and operable by an internal user who did not build it.

Tasks:

- [x] Add a release note for completed v0.2-v0.8 capabilities and migration notes.
- [x] Add a release check command or `ai doctor` extension for Node, pnpm, provider CLIs, config, server token, allowed workdirs, and dashboard build.
- [x] Refresh config examples for local CLI, 9router, hybrid, safe-review, and server mode.
- [x] Add operator runbook sections for startup, shutdown, queue recovery, artifact cleanup, and common failures.
- [x] Add a one-command local server/dashboard start path or documented script pair.

Acceptance:

- A fresh internal user can run a dry-run queue job from docs alone.
- Release checks identify missing runtime/provider/config prerequisites with actionable messages.

## Phase 9 - v1.0 Senior Workflow Integration

Status: completed

Goal: integrate GitHub Issue/PR workflows while keeping senior engineers in control.

Tasks:

- [x] Add an external task model for GitHub issues and PRs with source metadata, title, body, comments, labels, repo, base branch, and acceptance hints.
- [x] Add manual GitHub Issue URL intake that normalizes an issue into an internal task without writing files.
- [x] Add manual GitHub PR URL intake that loads diff metadata and produces staff-level review output.
- [x] Persist external task metadata into run-state and artifact-index.
- [x] Add approval-gated external updates so comments/status/PR actions never happen implicitly.

Acceptance:

- A senior engineer can run issue planning or PR review from a URL without copying context manually.
- No external comment, branch, commit, or PR is created without explicit approval.
- Existing baseline gates remain green.

## Phase 10 - v1.1 Staff-Level Review And Test Planning

Status: completed

Goal: make reviews and test plans useful to senior engineers.

Tasks:

- [x] Add blast-radius review context from changed files, write targets, dependencies, and tests.
- [x] Add review output format optimized for PR findings: severity, file/line, risk, and suggested fix.
- [x] Add missing-test detection and required/optional test recommendations.
- [x] Add pre-implementation test plan generation for issue mode.
- [x] Reconcile test plan with actual checks after implementation.

Acceptance:

- Review mode prioritizes bugs, regressions, behavioral risk, and missing tests.
- Risky changes have an explicit test strategy or documented residual risk.

## Phase 11 - v1.2 Artifact To PR Workflow

Status: completed

Goal: convert successful artifact runs into reviewable branches and PRs.

Tasks:

- [x] Add branch-name generation from task/run metadata.
- [x] Add approval-gated artifact apply, stage, and commit workflow.
- [x] Generate commit messages from run-state summaries.
- [x] Generate PR descriptions with summary, tests, risks, rollback, and artifact links.
- [x] Optionally create GitHub PRs after explicit approval.

Acceptance:

- The system never pushes directly to a protected branch by default.
- PR descriptions are grounded in verified run data.

## Phase 12 - v1.3 Safe Refactor Mode

Status: completed

Goal: let senior engineers run large refactors through analysis-first, small-batch execution.

Tasks:

- [x] Add read-only refactor analysis mode with dependency graph and affected file groups.
- [x] Separate mechanical changes from behavioral changes in plans.
- [x] Split large refactors into PR-sized batches.
- [x] Add per-batch verification and rollback notes.
- [x] Block broad regex rewrites unless explicitly approved and scoped.

Acceptance:

- Refactor mode can produce a safe staged plan without writing files.
- Each implementation batch remains reviewable by a senior engineer.

## Phase 13 - v1.4 Contract Intelligence

Status: planned

Goal: strengthen task contracts into a modular requirement-verification layer.

Tasks:

- [ ] Split `task-requirements.ts` into domain extractors for UI, API, config, security/dependency, tests, and migrations.
- [ ] Add contract extractor registration so new domains do not require editing one monolithic file.
- [ ] Add optional LLM-assisted contract suggestions with deterministic explanation and validation.
- [ ] Add targeted fixer hints for failed contracts.
- [ ] Surface contract coverage trends by project and task type.

Acceptance:

- New contract domains can be added independently.
- Missing requirements fail with useful repair hints before final write.

## Phase 14 - v1.5 Operator Trust And Team Scale

Status: planned

Goal: mature observability, schema versioning, retention, dashboard automation, and integrations.

Tasks:

- [ ] Add schema versions to run-state, artifact-index, audit events, and public API payloads where missing.
- [ ] Add migration/normalization helpers for old artifact and failure-class shapes.
- [ ] Add retention policy for artifacts, audit events, logs, and queue records.
- [ ] Add health history, queue latency, retry rate, failure-class, provider degradation, and cost metrics.
- [ ] Add browser-level dashboard smoke tests for release-critical workflows.
- [ ] Add identity-provider role mapping and webhook/event export.

Acceptance:

- Operators can answer what happened, who approved it, what changed, what it cost, and how to recover.
- Old artifacts remain readable after schema evolution.
- Multiple teams can operate separate projects without mixing artifacts, queues, budgets, or permissions.
