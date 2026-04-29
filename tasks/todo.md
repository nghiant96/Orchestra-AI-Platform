# Current Project Tasks

Last updated: 2026-04-29

## Roadmap Reset

- [x] Remove obsolete root review documents.
- [x] Remove obsolete roadmap, dashboard, vector-search, and system-upgrade planning files.
- [x] Preserve `tasks/lessons.md` as the project learning log.
- [x] Write the new canonical roadmap to `tasks/roadmap.md`.
- [x] Write the detailed execution plan to `tasks/implementation-plan.md`.
- [x] Reset `tasks/todo.md` to current active work only.

## Next Implementation Queue

- [x] Phase 1.3: Improve Dashboard Operations UX.
- [x] Phase 1.4: Document and harden Quality Gate Policy.
- [x] Phase 1.5.1: Decompose Job Detail into stable section components.
- [x] Phase 1.5.3: Decompose Config View into policy panels without changing form shape.
- [x] Phase 1.5.4: Add Project Health from existing health/artifact data.
- [ ] Phase 3.1-3.3: Add explainable risk policy and show approval decisions.
- [x] Phase 2.1: Add generic Task Contract model.
- [x] Phase 2.2: Add deterministic contract extraction beyond Event Feed.
- [x] Phase 2.3: Migrate Event Feed requirement guards into Task Contracts.
- [x] Phase 2.4: Expand contract results in Job Detail with pass/fail state.

## Completion Notes

- `tasks/roadmap.md` is now the roadmap source of truth.
- `tasks/implementation-plan.md` is now the concrete phase-by-phase execution plan.
- Old review and roadmap documents have been removed from the active project tree.
- Claude's roadmap assessment has been incorporated where it affects roadmap clarity: explicit zero test failure gate, v0.2.5 Dashboard Polish, and Task Contract migration path.
- Task Contract foundation is implemented for Event Feed requirements and surfaced in pending approval plans.
- Dashboard job detail now surfaces retry checkpoints, failure detail, explicit approve/reject/retry/resume/cancel actions, and contract status/suggested fixes.
- README now documents the safe profile gate set used for this repository.
- Approval mode and policy decisions are now visible in health responses and job detail.
- Job Detail and Config View have been split into smaller dashboard components while preserving caller and save behavior.
- Project Health now derives latest baseline check status from existing job/tool-result data.
- Deterministic Task Contract extraction now covers common UI layout, API/schema preservation, risky-test, and security/dependency tasks.
- Initial risk policy now classifies low/medium/high/blocked jobs and explains approval decisions; remaining Phase 3 work is artifact persistence, diff-size/generated-file signals, and strict reviewer enforcement.
- Analytics now includes provider performance metrics for run count, failure rate, average duration, and total cost from existing artifact provider metrics.
- Policy decisions are now persisted into run-state and artifact-index, including risk signals for paths, dependency/security areas, broad generated-file scope, and large diffs.
- Multi-project foundation now exposes `/projects`, role-aware operator/admin permissions, and `/audit` events for job, queue, config, and lesson actions.
- Learning foundation now reads/writes `tasks/lessons.md`, injects relevant lessons into planning, proposes rules from repeated failure classes, and surfaces lessons in the dashboard.
