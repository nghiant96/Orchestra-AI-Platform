# Roadmap Implementation Plan

Last updated: 2026-04-29

This plan breaks the roadmap into concrete implementation phases. Each phase should leave the repository with passing baseline gates:

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`
- `pnpm run dashboard:build`
- `pnpm audit --audit-level high --registry https://registry.npmjs.org`
- `git diff --check`

## Phase 0 - Documentation And Source Cleanup

Status: planned

Goal: keep one source of truth for roadmap and execution planning.

Tasks:

- [ ] Keep `tasks/roadmap.md` as the only roadmap document.
- [ ] Keep `tasks/implementation-plan.md` as the detailed execution plan.
- [ ] Keep `tasks/todo.md` for active task checklists and completion records only.
- [ ] Remove obsolete review and roadmap documents from root and `tasks/`.
- [ ] Preserve `tasks/lessons.md` as the project learning log.

Acceptance:

- No stale `Review*.md`, `project_review.md`, or old roadmap files remain.
- New work references `tasks/roadmap.md` and `tasks/implementation-plan.md`.

## Phase 1 - v0.2 Green Operations Baseline

Status: planned

Goal: make queue, server, dashboard, and checks predictable for daily internal use.

### 1.1 Queue And Approval Semantics

Tasks:

- [ ] Treat `skip_approval=true` as auto-run for queue jobs.
- [ ] Keep manual approval as default when `skip_approval` is absent or false.
- [ ] Show approval mode in job detail and health responses.
- [ ] Add tests for auto-run and manual approval queue jobs.
- [ ] Ensure cancel, retry, resume, and clear-finished preserve consistent job status.

Acceptance:

- Queue jobs do not get stuck waiting for approval when auto-run is configured.
- Manual approval jobs visibly wait with a pending plan.

### 1.2 Queue Lifecycle Reliability

Tasks:

- [ ] Add graceful queue shutdown and active job draining.
- [ ] Ensure server close does not race active job writes.
- [ ] Ensure tests wait for terminal job states before temp cleanup.
- [ ] Add regression tests for cancel and shutdown behavior.

Acceptance:

- `tests/server-queue.test.ts` passes reliably in isolation and in full suite.

### 1.3 Dashboard Operations UX

Tasks:

- [ ] Rework Job Detail into sections: Summary, Plan, Contract, Checks, Review, Artifacts, Retry.
- [ ] Show failure class and retry hint prominently.
- [ ] Add explicit approve/reject/retry/resume actions with disabled/loading states.
- [ ] Keep Event Feed filters wrapped and count-aware.

Acceptance:

- A user can inspect a failed job and know the next action without terminal logs.

### 1.4 Quality Gate Policy

Tasks:

- [ ] Use package-scoped lint/typecheck/build when all changed files are inside one package.
- [ ] Run dashboard build for dashboard changes when build checks are enabled.
- [ ] Add focused tests for package build scoping.
- [ ] Document the recommended safe profile checks.

Acceptance:

- Dashboard changes run dashboard checks, not unrelated root checks.
- System changes can opt into focused test checks without forcing full tests for every task.

## Phase 2 - v0.3 Task Contracts

Status: planned

Goal: turn user intent into explicit requirements that can be checked.

### 2.1 Contract Model

Tasks:

- [ ] Add a `TaskContract` type with id, description, severity, check strategy, and status.
- [ ] Store contracts in plan artifacts.
- [ ] Include contracts in generator, reviewer, and fixer prompts.
- [ ] Add contract results to iteration artifacts.

Acceptance:

- Every generated candidate can be evaluated against the same contract.

### 2.2 Contract Extraction

Tasks:

- [ ] Extract UI layout contracts from task text.
- [ ] Extract API/schema preservation contracts.
- [ ] Extract test-required contracts for risky areas.
- [ ] Extract security/dependency contracts.
- [ ] Keep extraction deterministic first; add LLM-assisted extraction only after deterministic rules are stable.

Acceptance:

- Common UI, API, config, and dependency tasks produce useful contract items.

### 2.3 Contract Validation

Tasks:

- [ ] Move existing Event Feed requirement guards into the generic contract system.
- [ ] Fail candidates that miss medium/high contract requirements.
- [ ] Feed contract failures into fixer iterations.
- [ ] Add tests for pass/fail contract scenarios.

Acceptance:

- Missing requirements are caught before write.

### 2.4 Dashboard Contract Visibility

Tasks:

- [ ] Show contract list in Job Detail.
- [ ] Show pass/fail/unknown status per contract.
- [ ] Link failed contracts to suggested fixes when available.

Acceptance:

- Users can see exactly which requested requirements were satisfied.

## Phase 3 - v0.4 Policy-Based Automation

Status: planned

Goal: choose approval and verification behavior based on task risk.

### 3.1 Risk Scoring

Tasks:

- [ ] Add risk signals for path sensitivity, diff size, dependency files, auth/payment areas, migrations, and generated file count.
- [ ] Produce a risk score and risk class: low, medium, high, blocked.
- [ ] Persist policy decisions in artifacts.

Acceptance:

- Every job has an explainable risk class.

### 3.2 Policy Actions

Tasks:

- [ ] Low risk: auto-run with standard checks.
- [ ] Medium risk: pause after plan.
- [ ] High risk: pause after generate and use strict review.
- [ ] Blocked: require explicit manual approval before write.

Acceptance:

- Approval behavior follows policy unless explicitly overridden.

### 3.3 Dashboard Policy Explanation

Tasks:

- [ ] Show risk class and matched signals in Job Detail.
- [ ] Show why a job required approval.
- [ ] Show policy override source when applicable.

Acceptance:

- Users understand why a job did or did not pause.

## Phase 4 - v0.5 Productized Dashboard

Status: planned

Goal: make dashboard the primary operations surface.

Tasks:

- [ ] Activity Feed: recent jobs/runs, filters, counts, live status.
- [ ] Job Detail: full execution story and actions.
- [ ] Project Health: latest baseline gate status.
- [ ] Provider Performance: success rate, duration, cost, failure rate.
- [ ] Cost & Budget: daily/project trends and limits.
- [ ] Config Policy: safe editing for approval, budgets, routing, memory, and checks.

Acceptance:

- A user can operate common workflows without reading terminal output.

## Phase 5 - v0.6 Multi-Project And Team Readiness

Status: planned

Goal: support multiple repositories and operators safely.

Tasks:

- [ ] Add project registry.
- [ ] Add per-project queues and artifacts.
- [ ] Add role model: viewer, operator, admin.
- [ ] Add approval and config permissions.
- [ ] Add audit log for job creation, approval, writes, provider usage, and checks.

Acceptance:

- Multiple projects can run without mixing jobs, artifacts, or configuration.

## Phase 6 - v0.7 Learning System

Status: planned

Goal: improve behavior from prior executions and corrections.

Tasks:

- [ ] Convert recurring failures into proposed contract rules.
- [ ] Store user corrections in `tasks/lessons.md` or project memory.
- [ ] Inject relevant lessons into planning.
- [ ] Track provider quality, latency, and cost over time.
- [ ] Surface memory and lessons in dashboard.

Acceptance:

- The same requirement miss becomes less likely after correction.

## Immediate Next Sprint

Recommended order:

1. Complete Phase 1.3 Dashboard Operations UX.
2. Complete Phase 1.4 Quality Gate Policy documentation and safe profile checks.
3. Start Phase 2.1 Contract Model.
4. Migrate Event Feed requirement guards into the generic contract model.
5. Add dashboard visibility for contract results.
