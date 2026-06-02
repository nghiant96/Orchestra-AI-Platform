# Orchestra AI Platform - Issue and Sprint Breakdown

Last updated: 2026-06-02

Tai lieu nay tach [ORCHESTRA_REALISTIC_ASSESSMENT_AND_ROADMAP.md](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ORCHESTRA_REALISTIC_ASSESSMENT_AND_ROADMAP.md) thanh sprint va issue cu the de dua vao thuc thi.

Nguyen tac:
- Moi issue phai co pham vi nho, co the dong doc lap.
- Moi sprint chi nham vao mot nang cap lon.
- Khong nhay sang Hermes PM hay scale-out truoc khi durable state va worker semantics on dinh.

---

## Sprint 0 - Stabilize Current Worker Platform

### Sprint goal
Lam cho worker/queue/cancel/lease/recover semantics on dinh va co the tin cay trong smoke flow hien tai.

### Issues

#### S0-I1 - Document execution backend semantics
- Scope:
  - Chot behavior cua `in-process`, `worker`, va `hybrid`.
  - Lam ro `hybrid` hien tai la worker-only cho den khi co internal-worker leasing.
  - Cap nhat docs va runtime warning neu can.
- Depends on:
  - Hien trang `ai-system/core/execution-backend.*`
  - README va server startup flow
- Done when:
  - Semantics khong con mui ho; docs va runtime khop nhau.
  - `hybrid` khong con mo ta sai nhu mot mode da hoan chinh.

#### S0-I2 - Harden stale lease recovery flow
- Scope:
  - Kiem tra lai stale lease detect/requeue/stall.
  - Dam bao terminal transitions khong bi mat khi claim/renew/complete/fail race.
  - Giu behavior requeue neu chua mutate filesystem, stalled neu da mutate.
- Depends on:
  - `ai-system/core/job-queue.ts`
  - worker runtime heartbeat/claim path
- Done when:
  - Race cases co regression tests.
  - No duplicate terminal transition.

#### S0-I3 - Close worker shutdown and teardown gaps
- Scope:
  - Dam bao worker shutdown khong de treo heartbeat/claim/upload.
  - Kiem tra once-mode va abort handling.
  - Chot cleanup path cho active job.
- Depends on:
  - `ai-system/worker/worker-runtime.ts`
- Done when:
  - Worker stop clean trong smoke and test flows.
  - Khong con teardown race khi worker dang chay job.

#### S0-I4 - Strengthen worker smoke coverage
- Scope:
  - Bo sung smoke/integration tests cho claim/start/checkpoint/complete/fail/recover.
  - Kiem tra canonical workspace root validation va worktree isolation path.
- Depends on:
  - Worker route and job queue contracts
  - `ai-system/worker/worker-worktree.ts`
- Done when:
  - Co test bao phu duong di chinh cua worker preview.
  - Smoke khong chi test "register OK" ma test "job lifecycle OK".

---

## Sprint 1 - Durable Store Foundation

### Sprint goal
Thay file-backed state bang store ben vung co migration va versioning.

### Issues

#### S1-I1 - Define OrchestraStore abstraction
- Scope:
  - Tao layer store chung cho jobs, workers, audit, artifacts, work items.
  - Giu file-backed implementation nhu baseline.
- Depends on:
  - Current file-backed queue/store modules
- Done when:
  - App layer khong phai biet details persistence.

#### S1-I2 - Implement SQLite job/worker/audit persistence
- Scope:
  - Dua jobs, workers, leases, audit, artifacts, work items vao SQLite.
  - Bao toan atomic write va idempotent update semantics.
- Depends on:
  - S1-I1
- Done when:
  - Server restart khong mat state.
  - Worker claim/lease van atomic tren store moi.

#### S1-I3 - Add schema migration runner
- Scope:
  - Tao migrations and schema version table.
  - Co commands inspect/migrate/reset neu can.
- Depends on:
  - S1-I1
- Done when:
  - Fresh DB va existing DB deu co duong migrate ro rang.

#### S1-I4 - Add durable state regression tests
- Scope:
  - Test migrate idempotency.
  - Test restart persistence.
  - Test claim uniqueness after restart.
- Depends on:
  - S1-I2, S1-I3
- Done when:
  - Co test cho crash/restart path, khong chi happy path.

---

## Sprint 2 - Operational Readiness

### Sprint goal
Lam cho he thong dung duoc trong team noi bo ma khong can nhin source code moi van hanh duoc.

### Issues

#### S2-I1 - Dashboard smoke test
- Scope:
  - Bo sung browser-level smoke test cho dashboard.
  - Kiem tra health, jobs, workers, work items, approval/recover flows.
- Depends on:
  - Dashboard routes va current preview surfaces
- Done when:
  - UI regressions bi bat truoc khi merge.

#### S2-I2 - Add queue and worker observability signals
- Scope:
  - Export queue latency, failure rate, worker heartbeat health, stalled count.
  - Lam ro what to watch khi co incident.
- Depends on:
  - Server health and worker state
- Done when:
  - Operator co du lieu de debug, khong chi log tho.

#### S2-I3 - Add rate limiting and abuse guardrails
- Scope:
  - Rate limit write-heavy endpoints.
  - Chot auth/failure logging policy.
- Depends on:
  - Server auth layer
- Done when:
  - Một token hop le khong the flood server vo han.

#### S2-I4 - Define retention and cleanup policy
- Scope:
  - Artifacts retention.
  - Audit retention.
  - Worker log retention.
  - Job cleanup policy.
- Depends on:
  - Current artifact/job cleanup paths
- Done when:
  - Data life cycle co quy tac ro rang, khong phu thuoc may man.

---

## Sprint 3 - Workspace Engine v1

### Sprint goal
Bien work item thanh don vi thuc thi that su, co lifecycle, evidence, branch/PR va linked runs.

### Issues

#### S3-I1 - Freeze WorkItem domain model v1
- Scope:
  - Chot status, relations, linked jobs, branch/PR metadata, checklist.
  - Loai bo ambiguity giua legacy task payload va new work item payload.
- Depends on:
  - Current work item implementation
- Done when:
  - Co mot model authoritative cho dashboard + API + runtime.

#### S3-I2 - Implement task graph execution model
- Scope:
  - Tao graph node states, dependencies, retries, resume.
  - Map node types sang inspect/design/implement/test/review/fix/handoff.
- Depends on:
  - S3-I1
- Done when:
  - Task lon co the chay theo node, khong chi monolithic run.

#### S3-I3 - Bind evidence to work item lifecycle
- Scope:
  - Checklist evidence.
  - Artifact/proof linkage.
  - Approval tied to evidence.
- Depends on:
  - S3-I1, S3-I2
- Done when:
  - Moi milestone co proof ro rang.

#### S3-I4 - Improve work item dashboard surfaces
- Scope:
  - Work item detail timeline.
  - Runs/branch/PR/checklist/evidence views.
  - Handoff action clarity.
- Depends on:
  - S3-I1, S3-I2, S3-I3
- Done when:
  - Operator co the doc state ma khong can raw artifacts.

---

## Sprint 4 - Hermes Integration

### Sprint goal
Cho Hermes dong vai AI PM/plan coordinator, nhung khong lam mo control plane.

### Issues

#### S4-I1 - Define Hermes-Orchestra contract
- Scope:
  - Chot Hermes lam gi va khong lam gi.
  - Chot API/MCP boundary va ownership.
- Depends on:
  - Workspace engine and server API
- Done when:
  - Hermes khong viec chung voi execution semantics.

#### S4-I2 - Harden MCP read/write permissions
- Scope:
  - Token-role mapping.
  - Actor requirement.
  - Tool-by-tool permission matrix.
- Depends on:
  - Current MCP auth surface
- Done when:
  - MCP write tools khong vuot role.

#### S4-I3 - Add lesson export and review loop
- Scope:
  - Export lessons, review notes, run summaries cho Hermes.
  - Chot feedback loop sau failed runs.
- Depends on:
  - Existing lessons workflow
- Done when:
  - Hermes nhan duoc feedback co cau truc, khong chi raw text.

#### S4-I4 - Add repo registry and workspace routing discipline
- Scope:
  - Repo/workspace mapping ro rang.
  - Hermes va work item routing theo repoId/workspace.
- Depends on:
  - Current repo registry/workspace validation
- Done when:
  - Hermes khong gui task sai workspace.

---

## Sprint 5 - Scale Out

### Sprint goal
Chuan bi he thong cho multi-machine va larger team usage ma khong lam vo semantics.

### Issues

#### S5-I1 - Evaluate Postgres cutover criteria
- Scope:
  - Dat dieu kien ro rang khi SQLite khong con du.
  - Chot migration path va rollback story.
- Depends on:
  - Durable store results
- Done when:
  - Quyết dinh sang Postgres co co so, khong phai cam tinh.

#### S5-I2 - Add worker assignment policy
- Scope:
  - Match theo workspace/capability.
  - Add queue selection rules that hơn first-come-first-served.
- Depends on:
  - Worker registry and durable state
- Done when:
  - Worker khong nhan job khong mount duoc workspace.

#### S5-I3 - Improve process supervision and timeout policy
- Scope:
  - Provider command lifecycle.
  - Kill/timeout/restart rules.
  - Structured exit diagnostics.
- Depends on:
  - Worker runtime and provider adapter
- Done when:
  - Provider treo khong keo theo job state mo ho.

#### S5-I4 - Multi-host operator readiness
- Scope:
  - Ops docs, runbook, failure handling, recovery guidance.
  - Dashboard/metrics cues cho multi-worker usage.
- Depends on:
  - Observability and durable store
- Done when:
  - Team co the van hanh nhieu worker ma khong lo mat state.

---

## Suggested Execution Order

1. Sprint 0
2. Sprint 1
3. Sprint 2
4. Sprint 3
5. Sprint 4
6. Sprint 5

Neu can be hon nua, Sprint 0 va Sprint 1 co the chia thanh issue vertical slices:
- worker semantics
- durable store
- dashboard smoke
- work item model

Nhung khong nen bat dau Hermes PM truoc khi Sprint 0 va Sprint 1 dat xong.

