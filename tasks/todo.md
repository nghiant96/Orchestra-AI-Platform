# Current Project Tasks

Last updated: 2026-06-01

## Task: Handle Sprint 0-3 Execution Tranche

- [x] Add store mode and capability descriptor to runtime health metadata.
- [x] Expose worker counts and stalled queue counts in `/health`.
- [x] Update dashboard smoke coverage to lock the new health contract.
- [x] Keep README aligned with the new store/runtime knob.
- [x] Run typecheck and dashboard smoke verification.

Review result:

- Sprint 0/Sprint 2 hardening is now reflected in runtime health: the server reports store mode, store capabilities, queue stalled counts, and worker counts.
- Sprint 1 is now grounded by an explicit store descriptor, but the actual SQLite/Postgres durable backend is still the next implementation step rather than a claimed completion.

## Task: Write Realistic Assessment And Product-Ready Roadmap

- [x] Read current docs and implementation to separate as-is behavior from roadmap assumptions.
- [x] Write one canonical document that describes the real system state and the next upgrade path.
- [x] Verify the document only claims implemented behavior in the as-is section.

Review result:

- Added [ORCHESTRA_REALISTIC_ASSESSMENT_AND_ROADMAP.md](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ORCHESTRA_REALISTIC_ASSESSMENT_AND_ROADMAP.md) as the canonical document for current-state assessment plus the path to product-ready.
- The new doc keeps the as-is section grounded in implemented control-plane, worker-lease, worktree, and preview Workspace/Hermes behavior, and moves SQLite/Postgres/Hermes PM work into explicit roadmap phases.

## Task: Split Roadmap Into Sprints And Issues

- [x] Break the product-ready roadmap into sprint-level execution buckets.
- [x] Define concrete issue slices with dependencies and done criteria.
- [x] Save the issue breakdown in a repo-local planning document.

Review result:

- Added [tasks/orchestra-product-roadmap-issues.md](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/tasks/orchestra-product-roadmap-issues.md) with Sprint 0-5, concrete issue slices, dependencies, and done criteria.
- The issue breakdown keeps Sprint 0 and Sprint 1 as prerequisites for anything Hermes or scale-out related.

## Task: Implement Worker Foundation Hardening And Real Provider P2

- [x] Add alpha scripts and JS mirror sync check.
- [x] Lock worker queue terminal/checkpoint/lease/recover transitions.
- [x] Add external worker start transition and heartbeat lease result contract.
- [x] Harden MCP tools so actor is required and never defaults to operator.
- [x] Add worker provider adapter seam, worktree/artifact capture, and CodexProvider v1.
- [x] Add regression coverage and run targeted verification.

Review result:

- P0-P2 worker foundation is implemented for alpha: server/worker smoke scripts exist, `.js` mirrors are enforced by `pnpm check:js-mirrors`, external worker jobs now claim/start/run/complete under lease, busy heartbeats report lease renewal status, and MCP tools reject missing actors.
- CodexProvider v1 is the only real provider adapter. It runs in an isolated git worktree, uses command/env policy gates, captures diff/log/changed-file/verification artifacts, and keeps dry-run mutations out of the main checkout.
- Queue mutation races are covered with per-job locks plus worker-runtime retry for transient lock contention so terminal payloads are not dropped.
- Verification passed with root typecheck, targeted worker/queue/MCP/provider tests, `tsc` emit, and JS mirror drift check.

## Task: Fix CI Lint Regression

- [x] Reproduce `pnpm lint` failure locally.
- [x] Ignore generated `.js` mirrors in ESLint while keeping source `.ts`, `bin/**/*.js`, and hand-written `scripts/**/*.mjs` linted.
- [x] Fix actual source lint errors in worker provider/client/runtime, server imports, path policy, worker store, smoke script config, and dashboard detail effect.
- [x] Run lint, typecheck, JS mirror sync, diff check, and targeted worker/provider regressions.

Review result:

- CI lint regression is fixed. `pnpm lint` now passes without linting generated `.js` mirrors.
- TypeScript source remains the lint target and `.js` mirror correctness is covered separately by `pnpm check:js-mirrors`.

## Task: Review Real Worker Execution Backlog

- [x] Read `ORCHESTRA_IMPROVEMENT_BACKLOG_AND_REAL_WORKER_EXECUTION.md`.
- [x] Compare backlog assumptions with current worker/backend/MCP implementation.
- [x] Identify blockers, sequencing issues, missing acceptance criteria, and merge risks.
- [x] Summarize review findings and recommended next actions.

Review result:

- Backlog direction is correct: real provider-backed worker execution is the right next major milestone.
- Main issue is sequencing: MCP actor hardening, locked terminal queue transitions, worktree isolation, command policy, and artifact capture should be promoted ahead of CodexProvider execution.
- Several testing backlog items are already covered by current worker tests and should be reclassified as existing regressions, leaving MCP actor auth and provider/worktree smoke as the missing checks.

## Task: Update README For Worker/Hermes Preview

- [x] Add high-level Local Worker, Hermes, Superpowers, and MCP status to README.
- [x] Add worker backend quick-start commands and environment variables.
- [x] Add worker/workspace API summary and project-structure entries.
- [x] Fix related documentation command examples that still use stale worker flags.
- [x] Run documentation diff checks.

Review result:

- README now reflects the completed Phase 0-6 preview surface at a high level: execution backends, local worker mode, worker safety contracts, Hermes/Superpowers docs, API endpoints, and new source directories.
- Fixed stale worker CLI examples in architecture/runbook docs to use `--server-url`, `--workspace-roots`, and the actual `POST /workers` route.
- Verification passed with `git diff --check`.

## Task: Complete Remaining Hermes Superpowers Plan

- [x] Inspect workflow, artifact, approval, MCP, lesson, dashboard, and repo-registry surfaces.
- [x] Complete Phase 4 Superpowers workflow profile without replacing existing `WorkflowMode`.
- [x] Complete Phase 5 MCP wrapper tools using service-layer functions.
- [x] Complete Phase 6 Hermes lesson export through API/MCP.
- [x] Complete dashboard worker/artifact/approval/work-item visibility gaps.
- [x] Complete repo registry route/store and workspace-root validation.
- [x] Run typecheck, targeted tests, dashboard build, and update implementation checklist.

Review result:

- Remaining Hermes Superpowers plan is complete across Phase 4, Phase 5, Phase 6, Dashboard Track, and Repo Registry Track.
- Superpowers now exists as a workflow profile that tightens risk/approval gates, injects methodology prompts, creates evidence checklist items, and binds approvals to artifact id/hash proof.
- MCP tools call the service layer directly, repo registry supports `repoId`, lessons are exported through API/MCP, and dashboard worker/approval/artifact visibility gaps are closed.
- Verification passed with root typecheck, new workflow/approval/MCP/lesson/repo tests, server/work-item/worker regressions, dashboard TypeScript build, Vite production build, and dashboard smoke test.

## Task: Harden Review Findings After Hermes Phases

- [x] Prevent worker dry-run jobs from mutating files.
- [x] Make file-backed worker claim genuinely race-resistant.
- [x] Forward worker completion/failure payloads instead of dropping result details.
- [x] Validate workspace registration using canonical realpath against allowed roots.
- [x] Temporarily lock or explicitly define `hybrid` execution semantics.
- [x] Add regression tests and run targeted verification.
- [x] Follow-up: enforce canonical realpath validation for worker registration workspace roots.

Review result:

- Fixed all five post-review hardening findings: worker dry-run no longer writes files or checkpoint mutations, file-backed claim uses a lock file, complete/fail route payloads are forwarded, workspace registration validates canonical realpaths against current allowed roots, and `hybrid` is worker-only until internal-worker leasing exists.
- Added regression coverage for dry-run mutation prevention, concurrent claim ownership, result payload forwarding, workspace symlink escape rejection, and hybrid queue behavior.
- Follow-up review gap fixed: worker registration now validates `workspaceRoots` through the same canonical path policy and stores canonical roots instead of raw user input.
- Verification passed with root typecheck, targeted worker/server/workspace tests, and JS mirror emission via `tsc`.

## Task: Complete Phase 3 Work Item API Normalization

- [x] Preserve Hermes-style optional fields on work items.
- [x] Normalize legacy `workflow` payloads into `workflowProfile`.
- [x] Expose work item events and linked job/lease details from the server.
- [x] Surface the enriched work item detail and timeline in the dashboard modal.
- [x] Run typecheck, targeted work/workspace/server tests, and dashboard build.

Review result:

- Phase 3 is complete and work items now carry the compatibility fields required by Hermes without changing `WorkItemStatus`.
- The new event route and linked job snapshots make the detail view explain status, run history, artifacts, approvals, and worker leases.
- Verification passed with `./node_modules/.bin/tsc --noEmit`, targeted work-item/workspace/server/worker tests, and the dashboard production build.

## Task: Complete Phase 2 Local Worker CLI

- [x] Add `ai worker start` CLI parsing and help text.
- [x] Load worker runtime config from env and CLI overrides.
- [x] Register, heartbeat, claim, execute, and complete/fail jobs from the local worker loop.
- [x] Upload redacted worker logs and checkpoint filesystem mutations before apply.
- [x] Make shutdown graceful so queue-backed tests and local teardown do not race cleanup.
- [x] Run typecheck and targeted worker/server/security tests.

Review result:

- Phase 2 is complete and the local worker loop now runs end-to-end through the API contract.
- The worker path is covered by CLI parsing, runtime execution, log upload, mutation checkpointing, and graceful shutdown regressions.
- Verification passed with `./node_modules/.bin/tsc --noEmit` plus the targeted worker, server, queue, and security test suites.

## Task: Review & Fix Phase 1C Lease Expiry, Checkpoints, And Stall Policy

- [x] Sweep stale leases through the claim path so expired jobs are requeued or stalled before the next claim.
- [x] Preserve mutation checkpoints and use them to decide requeue versus stall.
- [x] Keep stalled jobs blocked from automatic claim and recoverable via explicit operator action.
- [x] Fix worker-route teardown flake by waiting for the final queued job to complete.
- [x] Re-run typecheck and targeted worker/server tests.

Review result:

- Phase 1C is now aligned with the architecture: heartbeat renews leases, claim sweeps stale leases, mutation checkpoints decide whether an expired job requeues or stalls, and stalled jobs require manual recovery.
- The worker-route smoke test now waits for its queued job to complete before server shutdown, which removes the teardown race that was obscuring the actual lease behavior.
- Verification passed with `./node_modules/.bin/tsc --noEmit` and the targeted stale-lease, worker-route, worker-claim, worker-store, and server queue tests.

## Task: Complete Phase 1.5 Security Foundation

- [x] Redact common API keys, GitHub/GitLab tokens, JWTs, AWS secrets, and npm tokens.
- [x] Enforce destructive command blocking in the command execution path.
- [x] Make route access method-aware so worker tokens only reach worker endpoints.
- [x] Validate canonical workspace paths and reject runtime symlink escapes.
- [x] Add regression coverage for redaction, command policy, path policy, token separation, and workspace registration.
- [x] Re-run typecheck and targeted security/server/workspace tests.

Review result:

- Phase 1.5 is complete: redaction now covers the tested secret formats, command policy is enforced before spawning processes, token routing is split by role and HTTP method, and workspace/job path resolution uses canonical realpaths instead of trusting raw user input.
- The targeted regression tests are green, including worker token gating, symlink/path handling, and workspace registration normalization on macOS-style temp paths.
- Verification passed with `./node_modules/.bin/tsc --noEmit` plus the targeted security, worker, workspace, and server queue test suites.

## Task: Review & Fix Phase 1B Worker Claim And Lease

- [x] Align claim/lease state with architecture contract (`assigned` + lease metadata).
- [x] Enforce worker selector, capability, and workspace-root eligibility.
- [x] Pause the internal server queue when `ORCHESTRA_EXECUTION_BACKEND=worker`.
- [x] Add regression coverage for selector/capability mismatch and claim idempotency.
- [x] Re-run typecheck and targeted worker/server tests.

Review result:

- Phase 1B is now aligned with the implementation plan and architecture doc: jobs claim into `assigned`, carry an explicit lease and worker id, and complete/fail stay lease-bound and idempotent.
- The worker backend no longer competes with external workers because the server pauses its internal drain loop in `worker` mode.
- Verification passed with `./node_modules/.bin/tsc --noEmit` and the targeted test set covering worker store, worker routes, worker claim/lease, and server queue behavior.

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
