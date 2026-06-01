# Current Project Tasks

Last updated: 2026-06-01

## Task: Harden Phase 1A Worker Registry

- [x] Hide worker `sessionToken` from all non-register worker API responses.
- [x] Reject invalid worker heartbeat statuses instead of persisting them.
- [x] Add regression coverage for secret leakage and invalid heartbeat status.
- [x] Re-run typecheck and targeted worker tests.

Review result:

- Worker registration still returns the bootstrap `sessionToken`, but worker list/detail/heartbeat/admin responses now strip it out before JSON serialization.
- Heartbeat now validates `status` against the worker enum and returns `400` on invalid input, which keeps the persisted worker state clean.
- Verification passed with `./node_modules/.bin/tsc --noEmit` and the targeted worker store/routes tests.

## Task: Fix Work Item Run Status Regression

- [x] Restore `404` for missing work items in `POST /work-items/:id/run`.
- [x] Keep `409` for “no executable graph node” responses.
- [x] Add a regression test for the missing-work-item case.
- [x] Re-run typecheck and targeted tests.

Review result:

- `runWorkItem()` now returns an explicit `statusCode` so the route can distinguish missing work items from graph-readiness conflicts.
- `POST /work-items/:id/run` once again returns `404` when the item is absent, which matches the pre-refactor API contract.
- Verification stayed green with the same targeted test set and `./node_modules/.bin/tsc --noEmit`.

## Task: Patch Phase 0 Regression Gaps

- [x] Preserve legacy `workflowMode` fallback semantics for external PR tasks.
- [x] Distinguish artifact metadata corruption from missing artifact files in job content lookup.
- [x] Add regression tests for the two Phase 0 edge cases.
- [x] Run typecheck and targeted tests after the fix.

Review result:

- `createJob()` now accepts raw `workflowMode` input and keeps the old PR fallback behavior when the payload is invalid or absent, so the route refactor no longer changes runtime semantics.
- `getJobFileContent()` now returns `500` for corrupted artifact metadata and `404` only for missing artifacts/files, which restores observability for broken run data.
- Verification passed with `./node_modules/.bin/tsc --noEmit` and the targeted Node test set.

## Task: Review Hermes + Superpowers + Local Worker Architecture

- [x] Review existing project lessons and current roadmap context.
- [x] Read the full architecture proposal.
- [x] Evaluate architectural fit, risks, missing contracts, and implementation phasing.
- [x] Summarize findings and recommended changes.
- [x] Add review result after completing the assessment.

Review result:

- Architecture direction is strong: server as control plane, local worker as execution plane, Hermes as gateway, and Superpowers as workflow policy fit the product roadmap.
- Highest-risk gap: the proposal introduces `/api/*`, new work item statuses, and remote worker assignment without an explicit compatibility/migration contract for the existing `/jobs`, `/work-items`, in-process queue, and dashboard flows.
- Recommended next step: rewrite the implementation plan around a lease-based worker queue and existing route/model compatibility before coding Phase 1.

## Task: Update Hermes + Superpowers Architecture Document

- [x] Add compatibility strategy for existing `/jobs` and `/work-items` routes.
- [x] Add worker lease model and queue migration guidance.
- [x] Clarify work item status migration instead of replacing current status names blindly.
- [x] Split workflow profile from existing execution workflow mode.
- [x] Adjust implementation phases and definition of done.
- [x] Review the updated document for consistency.

Review result:

- Updated `ORCHESTRA_HERMES_SUPERPOWERS_ARCHITECTURE.md` to make existing routes and models the compatibility baseline.
- Added lease-based worker claim semantics so worker execution is resilient to duplicate claims, laptop sleep, and stale jobs.
- Reframed Superpowers as `workflowProfile` and preserved current `WorkflowMode` as `executionMode`.

## Task: Harden Hermes + Superpowers Architecture Contracts

- [x] Add lease state machine and mutation/reassign rules.
- [x] Add compatibility normalizer guidance for mixed old/new fields.
- [x] Add explicit execution backend mode.
- [x] Bind approvals to immutable artifact/version references.
- [x] Add artifact integrity rules.
- [x] Clarify worker security enforcement layers.
- [x] Require proof of user approval for Hermes/MCP approvals.
- [x] Review the updated document for consistency.

Review result:

- Added seven hardening contracts to the architecture document: compatibility normalization, lease state transitions, execution backend mode, artifact immutability, approval artifact binding, worker enforcement layers, and Hermes approval proof.
- Clarified that post-mutation lease expiry must stall instead of auto-reassigning to another worker.
- Added phase acceptance criteria so these contracts are testable during implementation.

## Task: Review External Architecture Evaluations

- [x] Read `architecture_evaluation.md`.
- [x] Read pasted external evaluation text.
- [x] Compare external findings with the current architecture document.
- [x] Summarize accepted gaps, rejected concerns, and recommended next edits.

Review result:

- Both external reviews agree the architecture is implementable and significantly stronger after the compatibility, lease, artifact integrity, approval, and security hardening passes.
- The most important remaining issue is real: section 8.1 still states "keep current WorkItemStatus" but the sample TypeScript enum below it uses the proposed new status names.
- Recommended next edit: fix section 8.1, split Phase 1 into 1A/1B/1C, add Phase 0 prep, Phase 1.5 security, worker disable/drain APIs, claim eligibility rules, dry-run mode contract, and repo registry as roadmap.

## Task: Apply External Review Recommendations To Architecture

- [x] Fix section 8.1 `WorkItemStatus` contradiction.
- [x] Add worker admin APIs and claim eligibility rules.
- [x] Add dry-run/write/pr mode contract.
- [x] Add workflow profile precedence rules.
- [x] Add Phase 0, split Phase 1, and add Phase 1.5 Security.
- [x] Add repo registry as later roadmap.
- [x] Verify document consistency.

Review result:

- Applied the external review recommendations to `ORCHESTRA_HERMES_SUPERPOWERS_ARCHITECTURE.md`.
- Section 8.1 now keeps the current WorkItemStatus enum and models proposed names as optional `WorkItemStage`.
- Implementation phases now start with Phase 0 prep, split worker foundation into 1A/1B/1C, and add Phase 1.5 security before the Local Worker CLI.

## Task: Create Agent-Ready Implementation Plan

- [x] Create detailed phase-by-phase plan for other AI agents.
- [x] Include files, tasks, acceptance criteria, verification, and hand-off notes per phase.
- [x] Include dashboard and repo registry tracks.

Review result:

- Created `tasks/hermes-superpowers-implementation-plan.md` as the execution checklist for delegating phases to other AI agents.

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

## Task: Rename gemini-cli to agy-cli

- [x] Research and create implementation plan <!-- id: 0 -->
- [x] Rename `ai-system/providers/gemini-cli.ts` to `ai-system/providers/agy-cli.ts` and update class to `AgyCliProvider` <!-- id: 1 -->
- [x] Update provider registry in `ai-system/providers/registry.ts` <!-- id: 2 -->
- [x] Update default command & orchestration mappings in `ai-system/core/orchestrator-runtime.ts` and `ai-system/core/provider-router-utils.ts` <!-- id: 3 -->
- [x] Update utility and helper references in `ai-system/utils/config.ts`, `cost-calculator.ts`, `linter.ts` <!-- id: 4 -->
- [x] Update CLI command arguments, presets, and interactive text in `ai-system/cli/` <!-- id: 5 -->
- [x] Update configurations: `ai-system/config/rules.json`, `.ai-system.json.example`, `docker-compose.yml`, `Dockerfile` <!-- id: 6 -->
- [x] Update documentation files: `README.md`, `docs/` <!-- id: 7 -->
- [x] Run test suite to verify success <!-- id: 8 -->

## Immediate Next Move

- [x] Start with Phase A implementation details and lock down the startup/docs/release path. ✅ (2026-05-03)
- [x] Use Phase B only after the release path is reliable. ✅
- [ ] Do not expand intake or team-control features until the workspace loop is stable.

## Review Result: Gemini -> Agy Migration Check

- Reviewed the provider/router migration paths and the targeted runtime tests.
- Core provider migration is green: `provider-router`, `orchestrator-runtime`, and related config tests passed.
- Full suite check still has 8 failing `tool-executor` tests in this environment, but they all pass once a temporary `pnpm` shim is present. The failures are environmental, not a `gemini` -> `agy` regression.
- The remaining `gemini` strings are intentional support paths and model names: Antigravity stores settings under `~/.gemini/...`, and the dashboard/pricing helpers still reference Gemini model families.
