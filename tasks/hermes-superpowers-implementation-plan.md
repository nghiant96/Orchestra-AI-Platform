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

- [ ] Add redaction patterns for common API keys, GitHub/GitLab tokens, private keys, AWS/GCP secrets.
- [ ] Redact logs/artifacts before upload.
- [ ] Add realpath guard for repo/worktree paths.
- [ ] Reject symlink escape outside workspace roots.
- [ ] Add command denylist for destructive commands.
- [ ] Add approval-required command classification.
- [ ] Split auth tokens:
  - [ ] `AI_SYSTEM_SERVER_TOKEN`
  - [ ] `ORCHESTRA_WORKER_TOKEN`
  - [ ] `ORCHESTRA_HERMES_TOKEN`
- [ ] Ensure worker token cannot call dashboard/operator-only APIs.
- [ ] Ensure Hermes token cannot call worker-only APIs.

Acceptance criteria:

- [ ] Secret-like values are redacted before upload.
- [ ] Symlink escape outside roots is rejected.
- [ ] Destructive command attempts are blocked or require approval.
- [ ] Token role separation is tested.
- [ ] Existing local embedded server tests remain ergonomic.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- security
pnpm test -- server
```

Hand-off notes for next phase:

- List supported redaction patterns.
- List denied commands and approval-required commands.

---

## Phase 2 — Local Worker CLI

Goal: local machine can run the worker loop and execute a dummy job safely.

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

- [ ] Add CLI command `ai worker start`.
- [ ] Parse env/config:
  - [ ] `ORCHESTRA_SERVER_URL`
  - [ ] `ORCHESTRA_WORKER_TOKEN`
  - [ ] `ORCHESTRA_WORKER_NAME`
  - [ ] `ORCHESTRA_WORKER_LABELS`
  - [ ] `ORCHESTRA_WORKSPACE_ROOTS`
- [ ] Register worker on start.
- [ ] Heartbeat every 10 seconds or configured interval.
- [ ] Claim next job.
- [ ] Execute dummy/no-op job first.
- [ ] Upload redacted logs.
- [ ] Complete/fail with valid leaseId.
- [ ] Send mutation checkpoint before filesystem mutation.
- [ ] Gracefully release or preserve lease on shutdown according to mutation state.

Acceptance criteria:

- [ ] `pnpm ai worker start` registers a worker.
- [ ] Worker heartbeats show up in API.
- [ ] Worker can claim a dummy job.
- [ ] Worker uploads redacted logs.
- [ ] Worker completes/fails with valid leaseId.
- [ ] Worker marks filesystem mutation before applying a patch.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- worker
pnpm ai worker start --help
```

Hand-off notes for next phase:

- Record CLI flags and env behavior.
- Record how local worker logs are surfaced.

---

## Phase 3 — Work Item API Normalization

Goal: make work items first-class for Hermes/Worker while preserving existing dashboard and CLI flows.

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

- [ ] Keep current `WorkItemStatus`.
- [ ] Add optional `stage`.
- [ ] Add optional `executionMode`.
- [ ] Add optional `workflowProfile`.
- [ ] Add optional `routingProfile`.
- [ ] Add optional `requestedBy`.
- [ ] Add optional `repo`/`RepoRef` if needed.
- [ ] Normalize `cwd` and `repo.localPath` through allowed-root guards.
- [ ] Normalize legacy `workflow` to `workflowProfile`.
- [ ] Add `GET /work-items/:id/events`.
- [ ] Link worker job ids and lease status back to work item detail.

Acceptance criteria:

- [ ] Legacy work item create payload still works.
- [ ] New Hermes-style payload normalizes to the same internal shape.
- [ ] Dashboard work item list/detail still renders old items.
- [ ] Work item event stream emits status/log/artifact/approval events.
- [ ] No status enum migration is required.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- work
pnpm run dashboard:build
```

Hand-off notes for next phase:

- Record final normalized work item shape.
- Record event stream schema.

---

## Phase 4 — Superpowers Workflow Profile

Goal: add Superpowers as a methodology profile without replacing existing `WorkflowMode`.

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

- [ ] Add `WorkflowProfileId`.
- [ ] Add `WorkflowProfile` type.
- [ ] Add registry for default, fast-fix, balanced, superpowers, strict-review.
- [ ] Preserve current `WorkflowMode` as `executionMode`.
- [ ] Implement precedence:
  - [ ] risk policy is the floor
  - [ ] workflow profile can tighten, not weaken
  - [ ] routing cannot bypass approval/security
- [ ] Add Superpowers prompt block.
- [ ] Add evidence checklist generation.
- [ ] Require plan artifact for Superpowers.
- [ ] Require plan approval for Superpowers.
- [ ] Require delivery approval for Superpowers.
- [ ] Bind approvals to immutable artifact ids and hashes.

Acceptance criteria:

- [ ] `workflowProfile=superpowers` requires plan artifact.
- [ ] Plan approval pauses execution.
- [ ] Evidence checklist is generated.
- [ ] Final delivery requires approval.
- [ ] Approval becomes stale if referenced artifact changes.
- [ ] Existing execution modes still work.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- workflow
pnpm test -- approval
```

Hand-off notes for next phase:

- Record profile config schema.
- Record prompt injection location.

---

## Phase 5 — MCP Wrapper

Goal: Hermes can call Orchestra through MCP tools that reuse internal services.

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

- [ ] Add MCP server entrypoint.
- [ ] Add auth using `ORCHESTRA_HERMES_TOKEN`.
- [ ] Implement `orchestra_create_work_item`.
- [ ] Implement `orchestra_run_work_item`.
- [ ] Implement `orchestra_get_work_item`.
- [ ] Implement `orchestra_get_events` if streaming/polling is supported.
- [ ] Implement `orchestra_get_artifacts`.
- [ ] Implement `orchestra_approve_step`.
- [ ] Implement `orchestra_cancel_work_item`.
- [ ] Ensure tools call service layer, not route handlers.
- [ ] Require approval proof: `approvedBy`, `approvalSource`, `userConfirmationId`, artifact hashes.
- [ ] Audit all actions as `actor=hermes` with user approver where relevant.

Acceptance criteria:

- [ ] MCP client can create work item.
- [ ] MCP client can run work item.
- [ ] MCP client can fetch status.
- [ ] MCP client can approve pending step only with proof and matching artifact hashes.
- [ ] MCP tools cannot execute raw shell or read/write arbitrary files.
- [ ] All MCP actions are audited.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- mcp
```

Hand-off notes for next phase:

- Record MCP tool schemas.
- Record Hermes config example.

---

## Phase 6 — Hermes Lesson Loop

Goal: completed or failed work items expose reusable lessons for Hermes memory.

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

- [ ] Add `GET /work-items/:id/lesson`.
- [ ] Generate lesson from task, plan, failed checks, repairs, final diff, commands passed, changed files.
- [ ] Add `summary` artifact.
- [ ] Add `lesson` artifact.
- [ ] Generate lesson for completed work items.
- [ ] Generate failure lesson for failed work items.
- [ ] Add MCP tool `orchestra_get_lesson`.
- [ ] Ensure lesson artifact redacts secrets.

Acceptance criteria:

- [ ] Completed work item has lesson JSON.
- [ ] Failed work item has failure lesson JSON.
- [ ] Hermes can retrieve lesson through MCP/API.
- [ ] Lesson includes evidence and changed files.
- [ ] Lesson does not include raw secrets.

Recommended verification:

```bash
pnpm typecheck
pnpm test -- lesson
pnpm test -- work
```

---

## Dashboard Track — Run In Parallel After Phase 1A

Goal: keep worker/work item state visible to operators.

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

- [ ] Add workers page.
- [ ] Show worker status, labels, capabilities, current job, last heartbeat.
- [ ] Add disable/enable/drain buttons with operator permission handling.
- [ ] Improve approval UI to show artifact ids/hashes and stale state.
- [ ] Improve artifact viewer for logs, diff, JSON, markdown summary.
- [ ] Show evidence checklist and worker assignment in work item detail.
- [ ] Ensure degraded 401/403 states render safely.

Acceptance criteria:

- [ ] Dashboard builds.
- [ ] Workers page handles empty, loading, error, and populated states.
- [ ] Approval UI shows exact artifact references.
- [ ] Work item detail remains backward-compatible with old work items.

Recommended verification:

```bash
pnpm run dashboard:build
pnpm test -- dashboard
```

---

## Repo Registry Track — Roadmap, Do Not Block Phase 1

Goal: Hermes submits `repoId` instead of local paths.

Primary agent objective:

- Add repo registry after worker path and root guard behavior is stable.

Tasks:

- [ ] Define `RepoRegistryEntry`.
- [ ] Add file-backed repo registry store.
- [ ] Add `GET /repos`, `POST /repos`, `GET /repos/:repoId`.
- [ ] Resolve worker-specific local path from `repoId`.
- [ ] Validate resolved path against worker workspace roots.
- [ ] Update Hermes/MCP schemas to prefer `repoId`.

Acceptance criteria:

- [ ] Existing `cwd` and `repo.localPath` still work.
- [ ] New `repoId` input resolves to worker-specific local path.
- [ ] Repo registry cannot bypass workspace root policy.
