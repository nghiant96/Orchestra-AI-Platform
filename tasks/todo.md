# Current Project Tasks

Last updated: 2026-05-03

> This file tracks the concrete implementation order for the AI Software Workspace.
> The active priority is Phase A, then Phase B, then the workspace/control-plane phases.
> Detailed step-by-step checklists live in `tasks/implementation-checklist.md`.

## Phase A - Stabilize v0.9

Goal: a fresh clone can run, understand, and verify the product without reading source code first.

- [x] Normalize startup experience.
  - [x] Ensure `local:dev` works in a clean shell with `.env` present.
  - [x] Add or refresh `.env.example` with the required server token and the common dev flags.
  - [x] Document the exact startup order for server, dashboard, and full-stack mode.
- [x] Align docs with runtime behavior.
  - [x] Verify README, security docs, and server docs say the same thing about token, host, and auth.
  - [x] Document which features are shipped, which are preview, and which are roadmap-only.
  - [x] Add a short "first run" path that shows the minimum required commands.
- [x] Refresh demo and proof.
  - [x] Create one representative low-risk bugfix demo.
  - [x] Add a dashboard walkthrough that shows job state, health, and work item detail.
  - [x] Capture the run/artifact path that proves the demo worked.
- [x] Keep CI green on the release path.
  - [x] Confirm `pnpm test` stays green (214/214 passed).
  - [x] Confirm `pnpm run dashboard:build` stays green.
  - [x] Confirm docs-linked commands are not stale.

Exit criteria:

- A new user can start the system without guessing hidden env vars. ✅
- The docs match the actual auth and host behavior. ✅
- The release path is reproducible in CI. ✅

## Phase B - Make the Core Loop Excellent

Goal: lower retry cost and make failures explain themselves.

- [x] Tighten run outputs.
  - [x] Improve run summaries so they point to the actual failure class.
  - [x] Keep retry hints short, actionable, and artifact-backed.
  - [x] Make JSON parsing and schema failures explicit.
- [x] Improve tool checks.
  - [x] Keep changed-file scoping reliable for lint/test/typecheck.
  - [x] Add fallback behavior when scoped checks are incomplete.
  - [x] Parse tool failures into structured issues instead of generic errors.
- [x] Improve context selection.
  - [x] Explain why files were included or excluded.
  - [x] Keep budget trimming deterministic and visible.
  - [x] Reuse cached project intelligence instead of replaying full context.
- [x] Budget repair loops.
  - [x] Keep retry counts bounded by error class.
  - [x] Avoid escalating model cost unless the failure class justifies it.
  - [x] Record why a stronger model or extra pass was spent.

Exit criteria:

- Simple bugfixes need fewer blind retries.
- Tool failures point to the real cause.
- Low-risk tasks stay cheap.

Phase B status: done.

Recent fixes:

- [x] Harden dashboard workspace selection against stale localStorage paths outside `allowedWorkdirs`.
- [x] Add regression coverage for safe workspace fallback in dashboard smoke tests and pure helper tests.
- [x] Add server-backed workspace registration so the navbar can register new allowed roots and persist them across restarts.

## Phase C - Finish Workspace Engine v1 Preview

Goal: work items become durable execution objects, not wrapped tasks.

- [ ] Complete the work item lifecycle.
  - [ ] Keep assessment, graph, checklist, linked runs, branch, and PR metadata authoritative.
  - [ ] Keep work item status transitions predictable across run/resume/retry.
  - [ ] Persist evidence with every meaningful state change.
- [ ] Complete graph execution mapping.
  - [ ] Map graph nodes to orchestrator requests cleanly.
  - [ ] Keep node status reconciled from run status.
  - [ ] Attach checklist evidence from node and job results.
- [ ] Finish workspace dashboard surfaces.
  - [ ] Make inbox and work board usable.
  - [ ] Make work item detail show graph, checklist, linked runs, and evidence.
  - [ ] Keep job/run views available beside workspace views.
- [ ] Finish branch and PR handoff.
  - [ ] Keep branch creation safe and traceable.
  - [ ] Keep commit and PR body grounded in evidence.
  - [ ] Keep approval boundaries explicit before branch/commit/PR actions.

Exit criteria:

- A work item can move from intake -> assessment -> graph -> run -> branch -> PR.
- The dashboard can explain what happened without raw artifact spelunking.
- Workspace stays preview until this loop is boring.

## Phase D - Team Control Plane

Goal: make the workspace safe and visible for operators and senior engineers.

- [ ] Add explicit role and permission surfaces.
  - [ ] Separate server auth from local embedded permissions.
  - [ ] Make operator-only actions obvious in API and UI.
  - [ ] Keep audit actor identity separate from auth headers.
- [ ] Strengthen audit and export.
  - [ ] Make audit browsing easier.
  - [ ] Add export paths for team review and incident response.
  - [ ] Record approvals, queue control, branch, and PR actions.
- [ ] Add operational analytics.
  - [ ] Show throughput, failure rate, approval lag, and retry cost.
  - [ ] Show queue health and retention impact.
  - [ ] Keep analytics bounded and cheap.
- [ ] Harden queue control.
  - [ ] Keep pause/resume/cancel safe.
  - [ ] Avoid hidden state or ambiguous action results.

Exit criteria:

- A team can answer who did what, when, and why.
- Operators can manage queue state without risky side effects.

## Phase E - External Task Intake And Auto-Triage

Goal: turn Jira/Trello/GitHub/CI signals into first-class work items.

- [ ] Define intake adapters.
  - [ ] Normalize external task shape into work item shape.
  - [ ] Track source, identity, and deduplication keys.
  - [ ] Preserve external provenance in stored metadata.
- [ ] Build auto-triage.
  - [ ] Assess incoming tasks before execution.
  - [ ] Route low-risk tasks to the cheap path.
  - [ ] Flag tasks that need human approval early.
- [ ] Sync status back.
  - [ ] Update the source system as work progresses.
  - [ ] Keep round-trip status changes traceable.
  - [ ] Avoid inventing states that the source does not understand.

Exit criteria:

- External tasks become durable work items with provenance.
- Status round-trips cleanly.

## Phase F - Scale Cost, Reliability, and Governance

Goal: keep the platform economical as usage grows.

- [ ] Tighten cost policy.
  - [ ] Add explicit budgets for classification, implementation, review, and repair.
  - [ ] Report token usage by stage and provider.
  - [ ] Keep summary-first replay as default.
- [ ] Improve caching and retention.
  - [ ] Cache project intelligence more aggressively.
  - [ ] Keep retention and cleanup policies explicit.
  - [ ] Avoid recomputing large stable context repeatedly.
- [ ] Harden governance.
  - [ ] Keep permissions, audit, and export paths robust for larger teams.
  - [ ] Ensure the server-mode path remains strict even as local mode stays easy.

Exit criteria:

- Common tasks stay cheap.
- Cost growth is measurable.
- Larger teams can adopt the system without losing control.

## Immediate Next Move

- [x] Start with Phase A implementation details and lock down the startup/docs/release path. ✅ (2026-05-03)
- [x] Use Phase B only after the release path is reliable. ✅
- [ ] Do not expand intake or team-control features until the workspace loop is stable.
