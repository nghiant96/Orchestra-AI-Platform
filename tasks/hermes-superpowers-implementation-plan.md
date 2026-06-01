# Hermes + Superpowers + Local Worker Implementation Plan

This plan breaks `ORCHESTRA_HERMES_SUPERPOWERS_ARCHITECTURE.md` into agent-sized execution phases.

Operating rules for every agent:

- Do not break existing `/jobs` and `/work-items` APIs.
- Keep current `WorkItemStatus` and current `WorkflowMode` backward-compatible.
- Add optional fields instead of changing persisted shapes unless a migration is explicitly included.
- Keep dry-run as the default behavior.
- Add tests in the same phase as the feature.
- Run at minimum `pnpm typecheck` and targeted tests for touched areas.
- Update `tasks/todo.md` and add a short result note after each phase.

---

## Phase 0 — Prep And Service Boundaries

Goal: make the current server ready for worker mode and MCP without changing runtime behavior.

Status: complete.

Primary agent objective:

- Extract shared service functions from route handlers so HTTP routes, future MCP tools, and worker APIs can reuse the same behavior.

Expected files:

- `ai-system/server/routes/work-items.ts`
- `ai-system/server/routes/jobs.ts`
- `ai-system/server/routes-context.ts`
- `ai-system/work/work-service.ts` or `ai-system/work/work-item-service.ts`
- `ai-system/jobs/job-service.ts` or `ai-system/core/job-service.ts`
- `ai-system/approvals/approval-service.ts`
- `ai-system/artifacts/artifact-service.ts`
- tests under `tests/` or colocated project test pattern

Tasks:

- [x] Read `docs/SERVER.md`, `docs/WORKSPACE.md`, `ai-system/server-app.ts`, `ai-system/server/routes/jobs.ts`, `ai-system/server/routes/work-items.ts`.
- [x] Add `ORCHESTRA_EXECUTION_BACKEND` config parsing with values `in-process`, `worker`, `hybrid`.
- [x] Default `ORCHESTRA_EXECUTION_BACKEND` to `in-process`.
- [x] Extract work item create/list/get/run/cancel/handoff behavior into service functions.
- [x] Extract job create/list/get/cancel/approve/reject behavior into service functions where practical.
- [x] Add an `ActorRef` compatibility wrapper around the current audit actor model.
- [x] Add `normalizeWorkItemInput()` for old and new payload shapes.
- [x] Ensure existing route responses stay backward-compatible.
- [x] Add regression tests for existing `/jobs` and `/work-items` flows.

Acceptance criteria:

- [x] Existing `/jobs` API tests pass.
- [x] Existing `/work-items` API tests pass.
- [x] `ORCHESTRA_EXECUTION_BACKEND` appears in server config/health or config inspection.
- [x] Route handlers delegate core behavior to services.
- [x] No dashboard or CLI behavior changes.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- server
pnpm test -- work
```

Hand-off notes for next phase:

- Service function names:
  - `ai-system/jobs/job-service.ts`: `createSyncRun`, `createJob`, `listJobs`, `getJob`, `cancelJob`, `approveJob`, `getJobFileContent`, `parseWorkflowMode`, `isPathWithinRoot`, `mapRunSummaryToQueueJob`.
  - `ai-system/work/work-item-service.ts`: `listWorkItems`, `createWorkItem`, `getWorkItem`, `assessWorkItem`, `runWorkItem`, `handoffWorkItem`, `cancelOrRetryWorkItem`, `normalizeWorkItemInput`.
- Route behavior intentionally left in handlers:
  - HTTP body parsing and response serialization.
  - `cwd` resolution and auth/permission checks.
  - Status-code mapping at the edge for service error objects.

Review result:

- Phase 0 is complete and stable after two regression fixes: preserving legacy PR workflow-mode fallback semantics and restoring `500` vs `404` distinction for artifact lookup errors.
- The extracted service boundary is now in place for future MCP tools and worker-facing APIs without changing the public `/jobs` and `/work-items` contracts.
- Verification passed with targeted tests plus `./node_modules/.bin/tsc --noEmit`.

---

## Phase 1A — Worker Registry Foundation

Goal: workers can register, heartbeat, and be shown read-only without claiming jobs.

Status: complete.

Primary agent objective:

- Add Worker model, store, routes, permissions, audit events, and dashboard read-only visibility.

Expected files:

- `ai-system/workers/worker-types.ts`
- `ai-system/workers/worker-store.ts`
- `ai-system/workers/worker-service.ts`
- `ai-system/workers/worker-routes.ts`
- `ai-system/server-app.ts`
- `ai-system/server/routes-context.ts`
- `dashboard/src/components/WorkersPage.tsx` or existing dashboard route structure
- `dashboard/src/hooks/useWorkers.ts`
- tests: `worker-store.test.ts`, `worker-routes.test.ts`

Tasks:

- [x] Define `Worker` type with id, name, version, os, arch, labels, capabilities, workspaceRoots, status, currentJobId, lastHeartbeatAt, createdAt.
- [x] Add worker statuses: `online`, `idle`, `busy`, `draining`, `disabled`, `offline`.
- [x] Implement file-backed `WorkerStore` first unless the project has already chosen SQLite.
- [x] Add `POST /workers/register`.
- [x] Add `POST /workers/:workerId/heartbeat`.
- [x] Add `POST /workers/:workerId/disable`.
- [x] Add `POST /workers/:workerId/enable`.
- [x] Add `POST /workers/:workerId/drain`.
- [x] Add `GET /workers` and `GET /workers/:workerId` if needed by dashboard.
- [x] Require operator/admin permission for admin actions.
- [x] Audit register, heartbeat status changes, disable, enable, drain.
- [x] Add dashboard read-only worker list.

Acceptance criteria:

- [x] Worker can register and receive a worker id/session token.
- [x] Heartbeat updates `lastHeartbeatAt`, status, current job, disk/cpu fields.
- [x] Disable/enable/drain mutate status and write audit events.
- [x] Dashboard can show workers without affecting job execution.
- [x] Existing in-process `/jobs` flow still works.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- worker
pnpm test -- server
pnpm run dashboard:build
```

Hand-off notes for next phase:

- Document worker store path and worker id format.
- Document worker auth/session token behavior:
  - registration returns the bootstrap `sessionToken` once
  - all read/update worker APIs must redact it from JSON responses

Review result:

- Phase 1A is complete.
- The worker registry now has a file-backed store, register/heartbeat/admin routes, audit logging, and dashboard visibility without changing `/jobs` execution behavior.
- Security and input validation gaps found in the first pass were fixed: worker tokens are no longer echoed back by read/update endpoints, and heartbeat status is validated before persistence.

---

## Phase 1B — Worker Claim And Lease

Goal: queued jobs can be claimed by exactly one eligible worker.

Status: complete.

Primary agent objective:

- Add atomic-ish claim semantics, lease metadata, claim eligibility policy, and idempotent complete/fail contracts.

Expected files:

- `ai-system/workers/worker-service.ts`
- `ai-system/workers/worker-routes.ts`
- `ai-system/core/job-queue.ts`
- `ai-system/core/normalizers.ts`
- `ai-system/core/execution-backend.ts`
- tests: `worker-claim-contract.test.ts`, `worker-lease-contract.test.ts`

Tasks:

- [x] Add `JobLease` type: workerId, leaseId, claimedAt, expiresAt, lastHeartbeatAt.
- [x] Add lease fields to queue job persistence as optional fields.
- [x] Implement `POST /workers/:workerId/jobs/claim`.
- [x] Enforce claim eligibility:
  - [x] backend mode is `worker` or `hybrid`
  - [x] job status is `queued`
  - [x] job has no active unexpired lease
  - [x] worker status is `idle` or `online`
  - [x] worker is not disabled or draining
  - [x] labels match workerSelector
  - [x] capabilities satisfy requiredCapabilities
  - [x] repo path realpath is inside worker workspaceRoots
  - [x] attempt count is below max attempts
- [x] Make claim operation race-resistant with file locking/atomic rename or a documented store primitive.
- [x] Add `POST /jobs/:jobId/complete` requiring valid leaseId.
- [x] Add `POST /jobs/:jobId/fail` requiring valid leaseId.
- [x] Make repeat complete/fail with same leaseId/result idempotent.
- [x] Reject complete/fail with stale or mismatched leaseId.

Acceptance criteria:

- [x] Two workers claiming one queued job results in exactly one success.
- [x] Ineligible worker receives deterministic rejection reason.
- [x] Worker cannot claim a job outside workspace roots.
- [x] Complete/fail requires valid leaseId.
- [x] In-process mode does not expose queued jobs to external workers.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- worker-claim
pnpm test -- worker-lease
pnpm test -- server
```

Hand-off notes for next phase:

- Record lease duration default.
- Record max attempts default.
- Record any file-store atomicity limitations.

Review result:

- Phase 1B is complete after aligning the implementation with the architecture contract: claim now produces an `assigned` job with a lease, worker selector/capability checks are enforced, and complete/fail remain idempotent on the lease boundary.
- The server now pauses its internal queue drain when `ORCHESTRA_EXECUTION_BACKEND=worker`, which prevents the local runner from racing external workers in worker mode.
- Verification passed with `./node_modules/.bin/tsc --noEmit` and the targeted worker/server test set.

---

## Phase 1C — Lease Expiry, Mutation Checkpoints, And Stall Policy

Goal: worker crash, sleep, or network drop does not corrupt worktrees or run duplicate mutations.

Status: complete.

Primary agent objective:

- Add lease renewal, stale lease detection, mutation checkpoints, and stalled recovery state.

Expected files:

- `ai-system/workers/worker-service.ts`
- `ai-system/core/job-queue.ts`
- `ai-system/jobs/job-service.ts`
- `ai-system/server/routes/jobs.ts`
- tests: `worker-stale-lease.test.ts`, `worker-mutation-checkpoint.test.ts`

Tasks:

- [x] Renew active lease on heartbeat.
- [x] Add stale lease detection on claim and/or background maintenance.
- [x] Add mutation checkpoint endpoint or service function.
- [x] Store checkpoint fields: jobId, leaseId, stage, filesystemMutated, worktreePath, timestamp.
- [x] Before mutation, expired lease may return job to `queued`.
- [x] After mutation, expired lease must move job to `stalled`.
- [x] Add manual recovery path for `stalled` jobs.
- [x] Prevent any worker from claiming a `stalled` job automatically.
- [x] Add audit events for lease expired, job stalled, job requeued, manual recovery.

Acceptance criteria:

- [x] Expired pre-mutation lease can be safely requeued.
- [x] Expired post-mutation lease becomes `stalled`.
- [x] Stalled job requires manual recovery.
- [x] Reclaim never runs two workers against the same worktree.
- [x] Existing cancelled/failed/completed job behavior remains stable.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- stale
pnpm test -- mutation
pnpm test -- worker
```

Hand-off notes for next phase:

- Document the manual recovery endpoint/command.
- Document stalled job dashboard state.

Review result:

- Phase 1C is complete: heartbeat renews leases, stale leases are swept on claim, mutation checkpoints decide requeue versus stall, and stalled jobs require explicit operator recovery.
- The worker backend stays safe because expired pre-mutation leases can be reclaimed, while post-mutation expiry is forced into `stalled` and blocked from auto-claim.
- Verification passed with `./node_modules/.bin/tsc --noEmit` and the targeted worker/server test set.

---

## Phase 1.5 — Security Foundation

Goal: security guardrails exist before Local Worker executes provider commands on a user machine.

Primary agent objective:

- Add minimum path, command, token, and redaction enforcement.

Expected files:

- `ai-system/security/path-policy.ts`
- `ai-system/security/secret-redaction.ts`
- `ai-system/security/command-policy.ts`
- `ai-system/security/token-policy.ts`
- `ai-system/core/workspace-registry.ts`
- `ai-system/server-app.ts`
- tests: `secret-redaction.test.ts`, `command-policy.test.ts`, `path-policy.test.ts`, `token-policy.test.ts`

Tasks:

- [x] Add redaction patterns for common API keys, GitHub/GitLab tokens, private keys, AWS/GCP secrets.
- [x] Redact logs/artifacts before upload.
- [x] Add realpath guard for repo/worktree paths.
- [x] Prevent symlink escape outside workspace roots.
- [x] Add command denylist for destructive commands.
- [x] Add approval-required command classification.
- [x] Split auth tokens:
  - [x] `AI_SYSTEM_SERVER_TOKEN`
  - [x] `ORCHESTRA_WORKER_TOKEN`
  - [x] `ORCHESTRA_HERMES_TOKEN`
- [x] Ensure worker token cannot call dashboard/operator-only APIs.
- [x] Ensure Hermes token cannot call worker-only APIs.

Acceptance criteria:

- [x] Secret-like values are redacted before upload.
- [x] Symlink escape outside roots is prevented.
- [x] Destructive command attempts are blocked or require approval.
- [x] Token role separation is tested.
- [x] Existing local embedded server tests remain ergonomic.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- security
pnpm test -- server
```

Hand-off notes for next phase:

- List supported redaction patterns.
- List denied commands and approval-required commands.

Review result:

- Phase 1.5 is now complete: secret redaction covers the common provider/token formats used in tests, command policy blocks destructive shell invocations at the execution boundary, path policy validates canonical realpaths before requests reach the workspace layer, and token routing is method-aware so worker tokens only reach worker endpoints.
- Worker and workspace tests now prove the runtime contracts, including token separation, canonical path handling on macOS-style temp paths, and symlink normalization for workspace registration.
- Verification passed with `./node_modules/.bin/tsc --noEmit` plus the targeted security, worker, workspace, and server-queue test suites.

---

## Phase 2 — Local Worker CLI

Goal: local machine can run the worker loop and execute a dummy job safely.

Status: complete.

Primary agent objective:

- Add `ai worker start`, register/heartbeat/claim loop, safe executor shell, and lease-aware complete/fail.

Expected files:

- `ai-system/worker/worker-client.ts`
- `ai-system/worker/worker-loop.ts`
- `ai-system/worker/worker-runtime.ts`
- `ai-system/worker/worker-config.ts`
- `ai-system/worker/worker-safety.ts`
- `ai-system/worker/job-executor.ts`
- `ai-system/cli.ts`
- `ai-system/cli/arg-parser.ts`
- tests: `worker-cli.test.ts`, `worker-loop.test.ts`

Tasks:

- [x] Add CLI command `ai worker start`.
- [x] Parse env/config:
  - [x] `ORCHESTRA_SERVER_URL`
  - [x] `ORCHESTRA_WORKER_TOKEN`
  - [x] `ORCHESTRA_WORKER_NAME`
  - [x] `ORCHESTRA_WORKER_LABELS`
  - [x] `ORCHESTRA_WORKSPACE_ROOTS`
- [x] Register worker on start.
- [x] Heartbeat every 10 seconds or configured interval.
- [x] Claim next job.
- [x] Execute dummy/no-op job first.
- [x] Upload redacted logs.
- [x] Complete/fail with valid leaseId.
- [x] Send mutation checkpoint before filesystem mutation.
- [x] Gracefully release or preserve lease on shutdown according to mutation state.

Acceptance criteria:

- [x] `pnpm ai worker start` registers a worker.
- [x] Worker heartbeats show up in API.
- [x] Worker can claim a dummy job.
- [x] Worker uploads redacted logs.
- [x] Worker completes/fails with valid leaseId.
- [x] Worker marks filesystem mutation before applying a patch.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- worker
pnpm ai worker start --help
```

Hand-off notes for next phase:

- CLI flags now live on `ai worker start` and match the env config fields above, with `--once` for test/one-shot execution.
- Worker logs are redacted before upload and persisted via `POST /workers/:workerId/jobs/:jobId/logs`.
- Graceful shutdown now waits for the server queue to stop before filesystem cleanup, which keeps tests and local teardown stable.

Review result:

- Phase 2 is complete: the local worker CLI can register, heartbeat, claim, execute a dummy job, upload redacted logs, checkpoint filesystem mutations, and settle the lease with complete/fail.
- The runtime is backed by a worker client, config loader, safety helpers, executor, and loop orchestration in `ai-system/worker/*`, with CLI wiring in `ai-system/cli.ts` and `ai-system/cli/arg-parser.ts`.
- Verification passed with `./node_modules/.bin/tsc --noEmit`, the worker CLI tests, and the worker/queue/security regression suites.

---

## Phase 3 — Work Item API Normalization

Goal: make work items first-class for Hermes/Worker while preserving existing dashboard and CLI flows.

Status: complete.

Primary agent objective:

- Normalize legacy and new work item payloads; add optional fields; expose event stream.

Expected files:

- `ai-system/work/work-item.ts`
- `ai-system/work/work-store.ts`
- `ai-system/work/work-service.ts`
- `ai-system/work/work-events.ts`
- `ai-system/server/routes/work-items.ts`
- `dashboard/src/hooks/useWorkItems.ts`
- tests: `work-item-normalizer-contract.test.ts`, `work-item-events.test.ts`

Tasks:

- [x] Keep current `WorkItemStatus`.
- [x] Add optional `stage`.
- [x] Add optional `executionMode`.
- [x] Add optional `workflowProfile`.
- [x] Add optional `routingProfile`.
- [x] Add optional `requestedBy`.
- [x] Add optional `repo`/`RepoRef` if needed.
- [x] Normalize `cwd` and `repo.localPath` through allowed-root guards.
- [x] Normalize legacy `workflow` to `workflowProfile`.
- [x] Add `GET /work-items/:id/events`.
- [x] Link worker job ids and lease status back to work item detail.

Acceptance criteria:

- [x] Legacy work item create payload still works.
- [x] New Hermes-style payload normalizes to the same internal shape.
- [x] Dashboard work item list/detail still renders old items.
- [x] Work item event stream emits status/log/artifact/approval events.
- [x] No status enum migration is required.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- work
pnpm run dashboard:build
```

Hand-off notes for next phase:

- Final normalized work item shape now includes optional `stage`, `executionMode`, `workflowProfile`, `routingProfile`, `requestedBy`, `repo`, `linkedJobs`, and `events`.
- Event stream schema is `WorkItemEvent` with `status`, `run`, `approval`, `artifact`, `log`, and `audit` entries, exposed via `GET /work-items/:id/events`.

Review result:

- Phase 3 is complete: work items now preserve Hermes-style optional fields, legacy payloads normalize correctly, linked job lease/status details are surfaced on the work item detail response, and the event stream API is available for the dashboard.
- The dashboard detail modal now loads enriched work item detail plus the event timeline, and the runs tab shows linked job/lease state instead of only raw ids.
- Verification passed with `./node_modules/.bin/tsc --noEmit`, targeted work-item/workspace/server/worker tests, and the dashboard production build.

---

## Phase 4 — Superpowers Workflow Profile

Goal: add Superpowers as a methodology profile without replacing existing `WorkflowMode`.

Status: complete.

Primary agent objective:

- Add workflow profile registry, Superpowers profile, prompt injection, evidence checklist, and approval gates.

Expected files:

- `ai-system/workflows/workflow-profile.ts`
- `ai-system/workflows/workflow-registry.ts`
- `ai-system/workflows/profiles/default.ts`
- `ai-system/workflows/profiles/superpowers.ts`
- `ai-system/core/workflow-modes.ts`
- `ai-system/core/orchestrator-run.ts`
- `ai-system/agents/planner.ts`
- `ai-system/agents/generator.ts`
- `ai-system/agents/reviewer.ts`
- tests: `workflow-profile.test.ts`, `superpowers-workflow.test.ts`, `approval-artifact-contract.test.ts`

Tasks:

- [x] Add `WorkflowProfileId`.
- [x] Add `WorkflowProfile` type.
- [x] Add registry for default, fast-fix, balanced, superpowers, strict-review.
- [x] Preserve current `WorkflowMode` as `executionMode`.
- [x] Implement precedence:
  - [x] risk policy is the floor
  - [x] workflow profile can tighten, not weaken
  - [x] routing cannot bypass approval/security
- [x] Add Superpowers prompt block.
- [x] Add evidence checklist generation.
- [x] Require plan artifact for Superpowers.
- [x] Require plan approval for Superpowers.
- [x] Require delivery approval for Superpowers.
- [x] Bind approvals to immutable artifact ids and hashes.

Acceptance criteria:

- [x] `workflowProfile=superpowers` requires plan artifact.
- [x] Plan approval pauses execution.
- [x] Evidence checklist is generated.
- [x] Final delivery requires approval.
- [x] Approval becomes stale if referenced artifact changes.
- [x] Existing execution modes still work.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- workflow
pnpm test -- approval
```

Hand-off notes for next phase:

- Record profile config schema.
- Record prompt injection location.

Review result:

- Phase 4 is complete: `workflowProfile` is now separate from `WorkflowMode`, profiles are registered under `ai-system/workflows/*`, and Superpowers tightens risk/approval policy without weakening security gates.
- Superpowers prompt and evidence checklist are injected into work-item execution, queued jobs retain `workflowProfile`, and plan/delivery approvals are tied to immutable artifact ids and hashes.
- Verification passed with root typecheck, workflow/profile tests, approval binding tests, and existing work-item/server/worker regression suites.

---

## Phase 5 — MCP Wrapper

Goal: Hermes can call Orchestra through MCP tools that reuse internal services.

Status: complete.

Primary agent objective:

- Add MCP server entrypoint and tools without duplicating HTTP route logic.

Expected files:

- `ai-system/mcp/server.ts`
- `ai-system/mcp/auth.ts`
- `ai-system/mcp/tools/create-work-item.ts`
- `ai-system/mcp/tools/run-work-item.ts`
- `ai-system/mcp/tools/get-work-item.ts`
- `ai-system/mcp/tools/get-artifacts.ts`
- `ai-system/mcp/tools/approve-step.ts`
- `ai-system/mcp/tools/cancel-work-item.ts`
- tests: `mcp-tools.test.ts`, `mcp-auth.test.ts`

Tasks:

- [x] Add MCP server entrypoint.
- [x] Add auth using `ORCHESTRA_HERMES_TOKEN`.
- [x] Implement `orchestra_create_work_item`.
- [x] Implement `orchestra_run_work_item`.
- [x] Implement `orchestra_get_work_item`.
- [x] Implement `orchestra_get_events` if streaming/polling is supported.
- [x] Implement `orchestra_get_artifacts`.
- [x] Implement `orchestra_approve_step`.
- [x] Implement `orchestra_cancel_work_item`.
- [x] Ensure tools call service layer, not route handlers.
- [x] Require approval proof: `approvedBy`, `approvalSource`, `userConfirmationId`, artifact hashes.
- [x] Audit all actions as `actor=hermes` with user approver where relevant.

Acceptance criteria:

- [x] MCP client can create work item.
- [x] MCP client can run work item.
- [x] MCP client can fetch status.
- [x] MCP client can approve pending step only with proof and matching artifact hashes.
- [x] MCP tools cannot execute raw shell or read/write arbitrary files.
- [x] All MCP actions are audited.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- mcp
```

Hand-off notes for next phase:

- Record MCP tool schemas.
- Record Hermes config example.

Review result:

- Phase 5 is complete: MCP has a token-authenticated tool dispatcher in `ai-system/mcp/*` that calls `work-item-service` and `job-service` directly.
- Approval via MCP now requires proof fields and matching artifact id/hash; missing or stale proofs are rejected before resolving the pending approval.
- Verification passed with MCP auth/tool tests and approval-artifact contract tests.

---

## Phase 6 — Hermes Lesson Loop

Goal: completed or failed work items expose reusable lessons for Hermes memory.

Status: complete.

Primary agent objective:

- Generate a lesson artifact and expose it via API/MCP.

Expected files:

- `ai-system/work/lesson-exporter.ts`
- `ai-system/work/work-service.ts`
- `ai-system/server/routes/work-items.ts`
- `ai-system/mcp/tools/get-lesson.ts`
- `ai-system/core/lessons.ts`
- tests: `lesson-exporter.test.ts`, `work-item-lesson.test.ts`

Tasks:

- [x] Add `GET /work-items/:id/lesson`.
- [x] Generate lesson from task, plan, failed checks, repairs, final diff, commands passed, changed files.
- [x] Add `summary` artifact.
- [x] Add `lesson` artifact.
- [x] Generate lesson for completed work items.
- [x] Generate failure lesson for failed work items.
- [x] Add MCP tool `orchestra_get_lesson`.
- [x] Ensure lesson artifact redacts secrets.

Acceptance criteria:

- [x] Completed work item has lesson JSON.
- [x] Failed work item has failure lesson JSON.
- [x] Hermes can retrieve lesson through MCP/API.
- [x] Lesson includes evidence and changed files.
- [x] Lesson does not include raw secrets.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- lesson
pnpm test -- work
```

Review result:

- Phase 6 is complete: work items now expose `GET /work-items/:id/lesson`, generate `lesson.json` and `summary.md`, and MCP exposes `orchestra_get_lesson`.
- Lesson artifacts include linked runs, evidence, changed files, commands, and failure metadata where available, with secret redaction applied before persistence.
- Verification passed with lesson-exporter tests, root typecheck, and work-item regression tests.

---

## Dashboard Track — Run In Parallel After Phase 1A

Goal: keep worker/work item state visible to operators.

Status: complete.

Primary agent objective:

- Add UI for worker list/detail, approvals, artifacts, and work item event visibility.

Expected files:

- `dashboard/src/hooks/useWorkers.ts`
- `dashboard/src/components/WorkersPage.tsx`
- `dashboard/src/components/WorkerStatusCard.tsx`
- `dashboard/src/components/ApprovalPanel.tsx`
- `dashboard/src/components/ArtifactViewer.tsx`
- `dashboard/src/components/EvidenceChecklist.tsx`
- `dashboard/src/components/work-item-detail/*`

Tasks:

- [x] Add workers page.
- [x] Show worker status, labels, capabilities, current job, last heartbeat.
- [x] Add disable/enable/drain buttons with operator permission handling.
- [x] Improve approval UI to show artifact ids/hashes and stale state.
- [x] Improve artifact viewer for logs, diff, JSON, markdown summary.
- [x] Show evidence checklist and worker assignment in work item detail.
- [x] Ensure degraded 401/403 states render safely.

Acceptance criteria:

- [x] Dashboard builds.
- [x] Workers page handles empty, loading, error, and populated states.
- [x] Approval UI shows exact artifact references.
- [x] Work item detail remains backward-compatible with old work items.

Recommended verification:

```bash
pnpm run dashboard:build
pnpm test -- dashboard
```

Review result:

- Dashboard track is complete: worker page now shows capabilities, error state, and disable/enable/drain actions; approval and artifact UI expose exact artifact references.
- Work item detail remains backward-compatible and continues to show checklist, events, linked jobs, and worker assignment.
- Verification passed with dashboard TypeScript build, Vite production build, and dashboard smoke test.

---

## Repo Registry Track — Roadmap, Do Not Block Phase 1

Goal: Hermes submits `repoId` instead of local paths.

Status: complete.

Primary agent objective:

- Add repo registry after worker path and root guard behavior is stable.

Tasks:

- [x] Define `RepoRegistryEntry`.
- [x] Add file-backed repo registry store.
- [x] Add `GET /repos`, `POST /repos`, `GET /repos/:repoId`.
- [x] Resolve worker-specific local path from `repoId`.
- [x] Validate resolved path against worker workspace roots.
- [x] Update Hermes/MCP schemas to prefer `repoId`.

Acceptance criteria:

- [x] Existing `cwd` and `repo.localPath` still work.
- [x] New `repoId` input resolves to worker-specific local path.
- [x] Repo registry cannot bypass workspace root policy.

Review result:

- Repo Registry track is complete: repos are stored under `.ai-system-server/repos.json`, HTTP routes expose list/register/get, and work item/MCP inputs can resolve by `repoId`.
- Registry resolution still validates canonical paths through `AI_SYSTEM_ALLOWED_WORKDIRS`, so `repoId` cannot bypass workspace root policy.
- Verification passed with repo-registry tests and server/work-item regression tests.
