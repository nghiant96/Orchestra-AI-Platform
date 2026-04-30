# AI Coding System Roadmap

Last updated: 2026-04-30

## Current Business Assessment

The system has completed the original v0.2-v0.8 roadmap and is now an internal release candidate for repeatable engineering automation. It has a real execution lifecycle: planning, context gathering, generation, tool checks, review, fix iterations, artifact storage, resume/retry, queue processing, approval checkpoints, dashboard visibility, policy decisions, multi-project boundaries, audit events, lessons, and smoke coverage.

The strongest business value is that the system can preserve execution state and explain prior runs through artifacts. This makes it suitable for repeatable engineering automation rather than one-off AI code generation.

The main business gaps have shifted from core capability to release readiness and operational trust:

- Release packaging needs a clean operator path: install, configure, start, verify, and recover.
- Browser-level dashboard smoke automation is still manual.
- API and artifact schemas need versioning before external integrations depend on them.
- Contract extraction is deterministic but not yet learning-rich or domain-extensible.
- Observability is useful but not yet production-grade for alerts, retention, or incident review.
- Team readiness has roles and audit foundations, but not full identity provider integration.

## v0.2 - Green Operations Baseline

Goal: make the system predictable and safe for daily internal use.

Key outcomes:

- Queue behavior is stable: enqueue, cancel, retry, resume, clear, approval, and skip approval all work consistently.
- Dashboard job detail clearly shows plan, files, checks, review issues, retry hints, and artifacts.
- Quality gates are selected by affected area:
  - `ai-system/**`: typecheck and focused tests.
  - `dashboard/**`: dashboard lint/build.
  - config/dependency changes: audit and schema validation.
- Failed jobs show an actionable next step.

Acceptance:

- Zero test failures across the full repository suite.
- Full baseline gates are green.
- A simple queue task can run without approval when `skip_approval=true`.
- A failed queue task shows a clear failure class and retry recommendation.

## v0.2.5 - Dashboard Polish

Goal: close the dashboard usability gap before building larger contract and policy features.

Key outcomes:

- Job Detail is split into clear sections: Summary, Plan, Checks, Review, Artifacts, Retry, and later Contract.
- FailurePanel shows failure class, retryability, retry hint, and suggested next action.
- Activity Feed has stable counts, wrapped filters, and live status clarity.
- Config View remains the policy/config editor, but large panels are decomposed for maintainability.
- Project Health shows the latest baseline gate state.

Acceptance:

- A user can understand a failed job and choose the right action without reading terminal output.
- Dashboard code is decomposed enough that Job Detail and Config View changes can be made safely.

## v0.3 - Task Contracts

Goal: make user requirements explicit, checkable, and visible.

Key outcomes:

- A Task Contract layer extracts concrete requirements from the user task.
- Existing `task-requirements.ts` Event Feed checks are migrated into the first generic contract extractors and validators.
- Contracts are stored in plan artifacts.
- Generator, reviewer, and fixer all receive the same contract.
- Deterministic checks reject candidates that miss contract items.
- Dashboard shows contract pass/fail status.

Example contract items:

- UI must not horizontally scroll.
- Filter labels must include per-status counts.
- API output must preserve an existing schema.
- Security-sensitive changes require tests and strict review.

Acceptance:

- Common UI, config, API, and dependency tasks produce useful contract items.
- Missing requirements fail before final write.
- Contract failures are visible in job detail.

## v0.4 - Policy-Based Automation

Goal: let the system choose the right safety level for each job.

Key outcomes:

- Risk policy classifies tasks as low, medium, high, or blocked.
- Low-risk jobs auto-run.
- Medium-risk jobs pause after plan.
- High-risk jobs require generation review or strict reviewer.
- Blocked jobs require explicit manual approval before write.
- Policy decisions explain why a job required approval.

Signals:

- Changed paths.
- Diff size.
- Dependency/security files.
- Auth/payment/migration areas.
- Historical failure rate.
- Provider reliability and cost.

Acceptance:

- Users no longer need to manually decide approval mode for every job.
- Dashboard explains the selected policy and risk signals.

## v0.5 - Productized Dashboard

Goal: make the dashboard the primary operations surface.

Key outcomes:

- Activity Feed for recent jobs and runs.
- Job Detail for plan, context, checks, review, diff, artifacts, and retry.
- Project Health for baseline gate status.
- Provider Performance for cost, duration, success rate, and failure rate.
- Cost & Budget for usage trends and limits.
- Config Policy editor for safe operational settings.

Actions:

- Approve/reject.
- Retry from stage.
- Apply artifact.
- Compare generated diff.
- Toggle policies safely.

Acceptance:

- A user can operate the system without reading terminal output.
- Dashboard explains what happened, why it happened, and what to do next.

## v0.6 - Multi-Project And Team Readiness

Goal: support multiple repositories and multiple operators safely.

Key outcomes:

- Project registry with per-project config, queue, budget, and artifacts.
- Roles: viewer, operator, admin.
- Approval permissions.
- Config edit permissions.
- Audit log for job creation, approval, file writes, provider usage, and check results.

Acceptance:

- Multiple projects can run without mixing jobs, artifacts, or configuration.
- Admins can trace who approved or changed each run.

## v0.7 - Learning System

Goal: improve system behavior from real execution history.

Key outcomes:

- Repeated failure patterns become new checks or contract rules.
- User corrections become project lessons.
- Planner reads relevant lessons before building plans.
- Provider routing learns from quality, cost, and latency.
- Dashboard exposes memory and lessons for review.

Acceptance:

- The same class of requirement miss does not repeat frequently.
- Routing and contract quality improve per project over time.

## v0.8 - Stabilization And Release Hardening

Goal: turn the completed internal platform into a maintainable release candidate.

Key outcomes:

- Stale roadmap/review docs are removed.
- Duplicate dashboard component trees are removed.
- Operations/API documentation and smoke checklist are available.
- Automated server smoke coverage exercises health, projects, jobs, stats, lessons, and audit.
- Newly emitted failure classes are normalized while legacy artifacts remain readable.
- High-churn server, tool adapter, and dashboard view code is split into smaller modules.

Acceptance:

- Full repository baseline gates are green.
- A new operator can understand core server/dashboard workflows without reading source code.
- The active codebase has one canonical dashboard component path.

## v0.9 - Release Candidate Packaging

Goal: make the platform easy to install, run, verify, and roll back for internal users.

Key outcomes:

- One-command local start for server and dashboard with documented environment defaults.
- `ai doctor` or equivalent release check validates Node, pnpm, provider CLIs, config, allowed workdirs, and dashboard build.
- Versioned release notes summarize completed capabilities and migration notes from previous configs.
- Config examples are current for local CLI, 9router, hybrid, safe-review, and server mode.
- Operator runbook covers startup, shutdown, queue recovery, artifact cleanup, and common failures.

Acceptance:

- A fresh internal user can install and run a dry-run queue job from docs alone.
- Release checks fail clearly when a required runtime/provider/config item is missing.
- Rollback and cleanup steps are explicit.

## v1.0 - Operator Trust And Observability

Goal: make production-like operation explainable, monitorable, and auditable.

Key outcomes:

- Dashboard and API expose health history, queue latency, job duration, failure classes, retry rate, and cost trends.
- Audit events cover file writes, artifact applies, config changes, approvals, queue operations, and lesson changes consistently.
- Artifact schemas and run-state schemas have explicit versions and migration helpers.
- Retention policy supports pruning old artifacts, logs, and audit events safely.
- Alerts or status summaries identify stuck queues, repeated failures, high costs, and provider degradation.

Acceptance:

- Operators can answer what happened, who approved it, what changed, what it cost, and how to recover.
- Old artifacts remain readable after schema changes.
- Long-running projects do not accumulate unbounded operational data.

## v1.1 - Contract Intelligence

Goal: improve task contracts from deterministic rules into a stronger requirement-verification layer.

Key outcomes:

- Contract extractors are modular by domain: UI, API, config, dependency/security, tests, data/migrations.
- LLM-assisted contract suggestions are available behind deterministic validation and user-visible explanations.
- Contract failures include targeted repair hints and affected files.
- Repeated contract misses can propose new deterministic extractors or project lessons.
- Dashboard shows contract coverage trends by project and task type.

Acceptance:

- Common requirement misses become visible before write, not after review.
- New contract extractors can be added without modifying a monolithic requirements file.
- Contract quality improves from real project history.

## v1.2 - Dashboard Automation And UX Confidence

Goal: make dashboard workflows testable and reliable enough to be a primary operations surface.

Key outcomes:

- Browser-level smoke tests cover project selection, job creation, approval/reject, retry/resume/cancel visibility, config view, analytics, lessons, and job detail.
- Dashboard bundle and route loading are measured with budgets.
- Accessibility and responsive checks cover the primary operational screens.
- Job Detail and Config View continue decomposing into focused sections when touched.

Acceptance:

- Dashboard release confidence does not depend only on manual inspection.
- Bundle growth is visible before it becomes a usability issue.
- Core dashboard workflows work on supported desktop and narrow viewport sizes.

## v1.3 - Team And Integration Scale

Goal: prepare the platform for broader team use and integration with external engineering systems.

Key outcomes:

- Identity provider integration can map users to viewer/operator/admin roles.
- Webhook or event export sends job, audit, and failure summaries to external systems.
- Project registry supports owner metadata, budgets, default policies, and disabled states.
- API clients can rely on stable schema versions and documented error responses.
- Optional CI mode can run review/fix/report workflows without dashboard dependency.

Acceptance:

- Multiple teams can operate separate projects without mixing artifacts, queues, budgets, or permissions.
- External integrations can consume stable job and audit events.
- Admins can disable or isolate unsafe projects.

## Priority Order

1. Package v0.9 as a usable internal release candidate.
2. Build v1.0 observability, schema versioning, and retention.
3. Expand v1.1 Contract Intelligence.
4. Add v1.2 browser-level dashboard automation and UX confidence gates.
5. Prepare v1.3 team and integration scale.
