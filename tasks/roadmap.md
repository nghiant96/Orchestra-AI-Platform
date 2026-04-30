# AI Coding System Roadmap

Last updated: 2026-04-30

## Current Business Assessment

The system has completed the original v0.2-v0.8 roadmap and is now an internal release candidate for repeatable engineering automation. It has a real execution lifecycle: planning, context gathering, generation, tool checks, review, fix iterations, artifact storage, resume/retry, queue processing, approval checkpoints, dashboard visibility, policy decisions, multi-project boundaries, audit events, lessons, and smoke coverage.

The strongest business value is that the system can preserve execution state and explain prior runs through artifacts. This makes it suitable for repeatable engineering automation rather than one-off AI code generation.

The main business gaps have shifted from core capability to senior-engineer workflow leverage:

- Issue and PR workflows are not yet integrated with the developer's normal review loop.
- Review intelligence needs to behave more like a staff-level reviewer: blast radius, missing tests, behavioral risk, and acceptance mismatch.
- Artifacts need a direct path to branches, commits, and PR descriptions.
- Test planning should explain what proves the change, not only run configured checks.
- Contract extraction is deterministic but not yet learning-rich or domain-extensible.
- Dashboard automation and team-scale integrations remain later priorities.

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

## v1.0 - Senior Workflow Integration

Goal: integrate the system into a senior engineer's normal issue, PR, and review workflow without removing human control.

Key outcomes:

- GitHub Issue and PR URLs can be ingested into a normalized internal task/review model.
- Issue mode creates a plan, risk summary, expected files, and test plan before implementation.
- PR mode performs staff-level review: blast radius, missing tests, behavioral risks, and contract/acceptance mismatch.
- Manual approval remains required before writes, commits, PR creation, or external comments.
- External source metadata is persisted into run-state and artifacts.

Acceptance:

- A senior engineer can review a GitHub issue or PR from this system without copying context manually.
- The system never comments, pushes, or opens a PR without explicit operator approval.
- Review output is useful as a PR review note and avoids style-only noise.

## v1.1 - Staff-Level Review And Test Planning

Goal: make review and test planning stronger than generic lint/test pass/fail signals.

Key outcomes:

- Blast radius analysis maps changed files to affected flows, contracts, and tests.
- Review findings are ranked by severity and include exact file/line references where possible.
- Missing tests are reported with required vs optional test recommendations.
- Test plans are generated before implementation and reconciled after checks run.
- PR-ready summaries include risks, tests run, residual gaps, and rollback notes.

Acceptance:

- Senior review mode prioritizes bugs, regressions, and missing tests over style preferences.
- Every risky change has an explicit test strategy or documented residual risk.

## v1.2 - Artifact To PR Workflow

Goal: turn successful artifacts into clean branch, commit, and PR handoff while preserving review control.

Key outcomes:

- Create branches from successful artifact runs using a safe naming convention.
- Apply artifacts, stage changes, and generate commit messages from run-state.
- Generate PR descriptions with summary, implementation notes, tests, risks, rollback, and artifact links.
- Optional GitHub PR creation is approval-gated.
- Audit events capture branch, commit, and PR actions.

Acceptance:

- No direct pushes to protected branches are performed by default.
- PR descriptions are generated from verified run data, not invented claims.

## v1.3 - Safe Refactor Mode

Goal: support senior-led refactors through analysis-first, small-batch execution.

Key outcomes:

- Read-only refactor analysis produces dependency graph, affected files, proposed batches, and test strategy.
- Mechanical changes are separated from behavioral changes.
- Large refactors are split into small PR-sized tasks.
- Each batch has explicit rollback and verification commands.
- Broad regex rewrites remain blocked unless explicitly approved and scoped.

Acceptance:

- Refactor mode can produce a safe staged plan without writing files.
- Implementation batches remain reviewable by a senior engineer.

## v1.4 - Contract Intelligence

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

## v1.5 - Operator Trust And Team Scale

Goal: mature observability, schemas, retention, and team integrations after senior workflow loops are valuable.

Key outcomes:

- Dashboard and API expose health history, queue latency, job duration, failure classes, retry rate, and cost trends.
- Artifact schemas and run-state schemas have explicit versions and migration helpers.
- Retention policy supports pruning old artifacts, logs, and audit events safely.
- Browser-level dashboard smoke tests cover release-critical workflows.
- Identity provider integration can map users to viewer/operator/admin roles.
- Webhook or event export sends job, audit, and failure summaries to external systems.

Acceptance:

- Operators can answer what happened, who approved it, what changed, what it cost, and how to recover.
- Old artifacts remain readable after schema changes.
- Multiple teams can operate separate projects without mixing artifacts, queues, budgets, or permissions.

## Priority Order

1. Package v0.9 as a usable internal release candidate.
2. Build v1.0 GitHub Issue/PR controlled workflow.
3. Build v1.1 staff-level review and test planning.
4. Add v1.2 artifact-to-PR handoff.
5. Add v1.3 safe refactor mode.
6. Expand v1.4 Contract Intelligence.
7. Mature v1.5 observability, dashboard automation, and team scale.
