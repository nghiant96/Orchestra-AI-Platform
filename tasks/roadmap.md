# AI Coding System Roadmap

Last updated: 2026-04-29

## Current Business Assessment

The system has moved beyond a simple prototype. It is now an internal automation platform with a real execution lifecycle: planning, context gathering, generation, tool checks, review, fix iterations, artifact storage, resume/retry, queue processing, approval checkpoints, and dashboard visibility.

The strongest business value is that the system can preserve execution state and explain prior runs through artifacts. This makes it suitable for repeatable engineering automation rather than one-off AI code generation.

The main business gaps are:

- Approval behavior needs to become policy-driven instead of manually toggled per workflow.
- Dashboard views need to guide decisions, not only display job data.
- Task requirements need to become explicit contracts, so the system can verify user intent deterministically.
- Quality gates need to vary by risk and affected area.
- Provider routing, memory, vector context, and costs need clearer product-facing explanations.
- Multi-project and team controls are still early.

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

## Priority Order

1. Finish v0.2 operational baseline.
2. Build v0.3 Task Contracts.
3. Add v0.4 policy-based automation.
4. Productize dashboard workflows in v0.5.
5. Expand to team/project readiness in v0.6.
6. Add learning feedback loops in v0.7.
