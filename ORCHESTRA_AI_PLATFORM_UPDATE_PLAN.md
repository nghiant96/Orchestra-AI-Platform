# Orchestra AI Platform — Detailed Upgrade Plan After Latest Update

> Mục tiêu: biến Orchestra AI Platform từ một **local-first AI orchestration prototype** thành một **AI Work Execution Platform** đủ ổn định để dùng nội bộ cho nhiều dự án, nhiều worker, nhiều AI CLI, có dashboard kiểm soát, audit, retry, recovery và tích hợp Hermes Agent như một AI PM.

---

## 1. Đánh giá hiện trạng sau update

### 1.1. Điểm mạnh hiện tại

Repo đã tiến thêm một bước lớn so với giai đoạn ban đầu. Các phần quan trọng đã có nền móng thật:

- CLI orchestration cho AI coding task.
- Server API/control plane.
- Dashboard quản lý job, config, activity.
- File-backed job queue.
- Worker backend preview.
- Worker register / heartbeat / claim / complete / fail.
- Lease-based execution để tránh nhiều worker nhận cùng một job.
- Stalled job recovery.
- Allowed workdir và path validation.
- Token role cho dashboard / worker / Hermes.
- Audit log.
- Workspace engine preview.
- Workflow profile / Superpowers / Hermes-facing direction.
- Smoke script cho orchestra server/worker.

### 1.2. Điểm yếu còn lại

Các phần dưới đây chưa nên coi là production-ready:

- Queue vẫn là file-backed, chưa đủ chắc cho multi-process/multi-worker lâu dài.
- Lock file còn đơn giản, có thể gặp edge case khi process crash hoặc chạy trên filesystem không ổn định.
- Worker backend mới ở mức preview.
- Hybrid mode hiện vẫn worker-only.
- Chưa có database schema/versioning rõ ràng.
- Dashboard chưa có browser-level smoke test.
- Auth vẫn chủ yếu dựa trên shared bearer token.
- Worker process supervision chưa đủ mạnh.
- Workspace Engine chưa thật sự là AI PM task graph/evidence engine.
- CI auto-repair loop còn là roadmap/alpha.
- Chưa có model cost/budget enforcement đủ rõ.

### 1.3. Kết luận hiện trạng

Trạng thái hiện tại nên được định nghĩa là:

> Alpha/RC local-first AI work execution platform, đủ tốt để dogfood nội bộ, chưa đủ chắc để giao cho team chạy production không giám sát.

---

## 2. Kiến trúc mục tiêu

### 2.1. Vai trò từng thành phần

```text
Hermes Agent
  Vai trò: AI PM / task manager / planner cấp cao
  Nhiệm vụ:
    - Nhận goal lớn từ user
    - Bóc tách thành work item
    - Ưu tiên task
    - Gọi Orchestra qua MCP/API
    - Theo dõi kết quả, lesson, evidence

Orchestra Server
  Vai trò: Control plane / job scheduler / policy engine
  Nhiệm vụ:
    - Quản lý repo registry
    - Quản lý work item
    - Enqueue job
    - Gán job cho worker
    - Quản lý approval
    - Audit log
    - Expose dashboard/API/MCP

Orchestra Worker
  Vai trò: Execution node
  Nhiệm vụ:
    - Register với server
    - Heartbeat
    - Claim job
    - Tạo isolated worktree
    - Gọi Codex/Claude/Antigravity CLI
    - Run checks
    - Upload logs/artifacts
    - Complete/fail job

Provider CLIs
  Vai trò: AI coding engine
  Ví dụ:
    - Codex CLI
    - Claude CLI
    - Antigravity CLI
    - Local CLI/provider adapter

Dashboard
  Vai trò: Human control panel
  Nhiệm vụ:
    - Xem queue/job/worker
    - Approve plan/checkpoint
    - Xem diff, logs, artifacts
    - Retry/recover/cancel job
    - Xem audit/metrics
```

### 2.2. Sơ đồ tổng thể

```text
User / Developer
      |
      v
Hermes Agent / CLI / Dashboard
      |
      v
Orchestra Server API
      |
      +--> Policy Engine
      +--> Work Item Engine
      +--> Job Scheduler
      +--> Approval Gate
      +--> Audit Log
      +--> Artifact Registry
      |
      v
Persistent Store SQLite/Postgres
      |
      v
Worker Pool
      |
      +--> Mac Worker: iOS/RN/Xcode/Codex
      +--> Ubuntu Worker: backend/docker/test
      +--> Local Dev Worker: quick dry-run
      |
      v
AI Provider CLIs + Tool Checks
```

---

## 3. Nguyên tắc triển khai

### 3.1. Ưu tiên thực dụng

Không cố làm distributed system phức tạp ngay. Đi theo lộ trình:

```text
File-backed queue
  -> SQLite local durable queue
  -> SQLite multi-worker nội bộ
  -> Postgres nếu cần team/cloud scale
```

### 3.2. Không phá flow hiện có

Mọi nâng cấp nên giữ tương thích với CLI hiện tại:

```bash
pnpm ai "task"
pnpm run server
pnpm run orchestra:server
pnpm run orchestra:worker
pnpm run orchestra:smoke
```

### 3.3. Feature flag rõ ràng

Các phần preview phải được bật qua env/config:

```bash
ORCHESTRA_EXECUTION_BACKEND=in-process|worker|hybrid
ORCHESTRA_STORE=file|sqlite|postgres
ORCHESTRA_WORKER_PROVIDER=dummy|codex|claude|agy
ORCHESTRA_ENABLE_WORKSPACE_ENGINE=true
ORCHESTRA_ENABLE_HERMES_MCP=true
```

### 3.4. Dry-run mặc định an toàn

Mọi job từ dashboard/API/Hermes nên mặc định là dry-run, trừ khi có approval hoặc config cho phép mutate.

---

## 4. Phase P0 — Stabilize Core Execution

> Mục tiêu: làm Orchestra chạy ổn thật ở local/server mode, không mất job, không duplicate execution, recovery rõ ràng.

### P0.1. Chuyển Queue/Worker/Audit sang SQLite

#### Lý do

File-backed queue hiện đủ cho prototype nhưng chưa đủ chắc cho nhiều worker/process. SQLite là bước hợp lý trước khi dùng Postgres.

#### Việc cần làm

- Thêm abstraction `Store`:

```ts
interface OrchestraStore {
  jobs: JobRepository;
  workers: WorkerRepository;
  audit: AuditRepository;
  artifacts: ArtifactRepository;
  workItems: WorkItemRepository;
}
```

- Tạo implementation:

```text
FileOrchestraStore      // giữ tương thích hiện tại
SqliteOrchestraStore    // store mới
```

- Thêm bảng SQLite:

```sql
jobs
workers
worker_heartbeats
job_leases
audit_events
artifacts
work_items
work_item_events
approvals
schema_migrations
```

#### Schema đề xuất

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  task TEXT NOT NULL,
  cwd TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  workflow_mode TEXT,
  workflow_profile TEXT,
  approval_mode TEXT,
  approval_policy_json TEXT,
  worker_id TEXT,
  lease_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  artifact_path TEXT,
  result_summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  execution_json TEXT,
  metadata_json TEXT
);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  os TEXT,
  arch TEXT,
  labels_json TEXT,
  capabilities_json TEXT,
  workspace_roots_json TEXT,
  current_job_id TEXT,
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_leases (
  job_id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

#### Acceptance criteria

- `pnpm test` pass.
- Server chạy được với `ORCHESTRA_STORE=file`.
- Server chạy được với `ORCHESTRA_STORE=sqlite`.
- Job queue survive server restart.
- Worker claim không duplicate job.
- Expired lease được requeue hoặc stalled đúng.

---

### P0.2. Migration system cho schema/config/artifact

#### Lý do

Release notes đã ghi schema versioning là planned. Cần làm ngay trước khi artifact/job format phình to.

#### Việc cần làm

- Thêm migration runner:

```text
ai-system/store/migrations/
  001_initial.sql
  002_worker_leases.sql
  003_work_items.sql
```

- Thêm command:

```bash
pnpm ai db migrate
pnpm ai db status
pnpm ai db reset --confirm
```

- Thêm schema version cho artifact:

```json
{
  "schemaVersion": 1,
  "kind": "run-artifact",
  "jobId": "..."
}
```

#### Acceptance criteria

- Fresh DB migrate được.
- Existing DB migrate idempotent.
- Server refuse chạy nếu schema quá cũ và cần migrate.
- Có test migration.

---

### P0.3. Worker Process Supervisor

#### Lý do

Worker hiện có lifecycle API nhưng cần lớp quản lý process thật khi gọi Codex/Claude/Agy.

#### Component mới

```ts
class WorkerProcessSupervisor {
  runProviderJob(input: ProviderJobInput): Promise<ProviderJobResult>;
  kill(jobId: string): Promise<void>;
  streamLogs(jobId: string, line: string): Promise<void>;
  enforceTimeout(jobId: string): void;
}
```

#### Việc cần làm

- Chuẩn hóa timeout:

```bash
ORCHESTRA_JOB_TIMEOUT_MS=1800000
ORCHESTRA_PROVIDER_TIMEOUT_MS=1200000
ORCHESTRA_CHECK_TIMEOUT_MS=600000
```

- Capture đầy đủ:

```text
stdout
stderr
exitCode
signal
startedAt
finishedAt
providerCommand
providerName
artifactPath
```

- Hard-kill process nếu quá timeout.
- Upload logs định kỳ về server.
- Cleanup worktree khi job done/fail nếu policy cho phép.
- Nếu provider treo, job phải fail có reason rõ.

#### Acceptance criteria

- Dummy provider chạy pass.
- Dummy provider treo bị timeout.
- Worker mất giữa job thì lease expire.
- Nếu chưa mutate filesystem thì requeue.
- Nếu đã mutate filesystem thì stalled.

---

### P0.4. Dashboard Smoke Test

#### Lý do

Dashboard là nơi approve/retry/recover. Nếu UI hỏng thì platform không vận hành được.

#### Thêm Playwright

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

#### Test cases tối thiểu

```text
1. Open dashboard
2. Health panel visible
3. Create dry-run job
4. Job appears in activity feed
5. Open job detail
6. Logs stream visible
7. Worker list visible
8. Queue status visible
9. Approval panel visible when job waits approval
10. Recover stalled job button visible for stalled job
```

#### Commands

```bash
pnpm run dashboard:smoke
pnpm run check:all
```

#### Acceptance criteria

- CI chạy được dashboard smoke headless.
- Fail UI smoke thì CI fail.
- Có screenshot/video artifact khi fail.

---

### P0.5. Hardening Auth/Token Config

#### Việc cần làm

- Không dùng default `change-me` ở production mode.
- Nếu `AI_SYSTEM_SERVER_MODE=true` mà token rỗng hoặc `change-me`, server cảnh báo mạnh hoặc refuse nếu `NODE_ENV=production`.
- Tách token role rõ:

```bash
ORCHESTRA_ADMIN_TOKEN=
ORCHESTRA_OPERATOR_TOKEN=
ORCHESTRA_VIEWER_TOKEN=
ORCHESTRA_WORKER_TOKEN=
ORCHESTRA_HERMES_TOKEN=
```

- Audit actor bắt buộc cho write action:

```http
X-AI-System-Actor: hermes-agent
X-AI-System-Role: operator
```

#### Acceptance criteria

- Viewer không cancel/recover/write được.
- Worker token chỉ gọi worker/job lease routes.
- Hermes token chỉ gọi MCP/work item/job enqueue routes theo quyền.
- Audit log ghi đúng actor/action.

---

## 5. Phase P1 — Make Workspace Engine Real

> Mục tiêu: biến Workspace Engine thành tầng quản lý work item thật, phục vụ Hermes Agent như AI PM.

### P1.1. Work Item Domain Model v1

#### Model đề xuất

```ts
interface WorkItem {
  id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: "low" | "medium" | "high" | "urgent";
  risk: "low" | "medium" | "high" | "blocked";
  repoId: string;
  cwd: string;
  branchName?: string;
  prUrl?: string;
  parentId?: string;
  dependencies: string[];
  taskGraph: TaskGraph;
  evidenceChecklist: EvidenceItem[];
  linkedJobs: string[];
  createdAt: string;
  updatedAt: string;
}
```

```ts
type WorkItemStatus =
  | "created"
  | "assessing"
  | "planning"
  | "ready"
  | "executing"
  | "reviewing"
  | "delivering"
  | "watching_ci"
  | "completed"
  | "blocked"
  | "failed";
```

#### Acceptance criteria

- Tạo work item từ CLI/API/dashboard.
- List/show/update status.
- Link job với work item.
- Work item survive restart.
- Dashboard hiển thị work item timeline.

---

### P1.2. Task Graph Engine

#### Mục tiêu

Một work item lớn phải được bóc thành DAG:

```text
inspect -> plan -> implement -> test -> review -> deliver
```

Hoặc với task phức tạp:

```text
inspect
  -> api-contract-check
  -> implementation
  -> unit-test
  -> integration-test
  -> review
  -> pr
```

#### Model đề xuất

```ts
interface TaskGraphNode {
  id: string;
  type: "inspect" | "plan" | "implement" | "test" | "review" | "deliver" | "custom";
  title: string;
  prompt: string;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked";
  dependsOn: string[];
  jobId?: string;
  evidenceRequired: string[];
}
```

#### Việc cần làm

- Deterministic graph builder cho task đơn giản.
- AI-assisted graph builder cho task lớn.
- Scheduler chỉ enqueue node `ready`.
- Node fail thì block downstream nodes.
- Retry node riêng biệt.

#### Acceptance criteria

- Work item có nhiều node chạy tuần tự đúng dependency.
- Fail node A thì node phụ thuộc không chạy.
- Retry node không tạo duplicate toàn bộ work item.
- Dashboard hiển thị graph.

---

### P1.3. Evidence Checklist

#### Mục tiêu

Không chỉ “AI nói đã xong”, mà phải có bằng chứng:

```text
- Typecheck passed
- Unit tests passed
- Changed files match expected targets
- No forbidden file touched
- Screenshot generated if UI task
- API contract preserved
- PR created
```

#### Model

```ts
interface EvidenceItem {
  id: string;
  title: string;
  kind: "check" | "diff" | "test" | "review" | "artifact" | "manual";
  required: boolean;
  status: "pending" | "passed" | "failed" | "waived";
  proof?: {
    type: "log" | "file" | "url" | "json";
    value: string;
  };
}
```

#### Acceptance criteria

- Job completion update evidence.
- Work item không completed nếu required evidence fail.
- User có thể waive evidence với audit reason.
- Dashboard hiển thị evidence rõ ràng.

---

### P1.4. Branch / PR Flow

#### Mục tiêu

Orchestra có thể tạo branch, commit, PR theo work item.

#### Flow

```text
work create
  -> work branch
  -> execute jobs in worktree
  -> collect diff
  -> review
  -> commit
  -> push
  -> create PR
  -> watch CI
```

#### Commands

```bash
pnpm ai work branch <id>
pnpm ai work commit <id>
pnpm ai work pr <id>
pnpm ai work ci watch <id>
```

#### Acceptance criteria

- Branch name deterministic:

```text
orchestra/<workItemId>-short-title
```

- PR body include:

```text
Summary
Changed files
Evidence checklist
Test results
AI review
Risk policy
Audit link
```

- CI fail có thể enqueue repair job.

---

## 6. Phase P2 — Hermes Agent Integration

> Mục tiêu: Hermes là AI PM, Orchestra là execution engine.

### P2.1. Define Hermes-Orchestra Contract

#### Hermes không nên làm

Hermes không nên trực tiếp:

- Spawn Codex trên nhiều máy.
- Tự quản lý worktree.
- Tự retry provider process.
- Tự ghi file vào repo.
- Tự quyết định bypass approval.

#### Hermes nên làm

Hermes nên:

- Nhận goal từ user.
- Tạo roadmap/work item.
- Gọi Orchestra API/MCP để enqueue execution.
- Theo dõi evidence.
- Đề xuất next action.
- Tổng hợp report.
- Học từ lesson/failure.

---

### P2.2. MCP Tools cho Hermes

#### Tools đề xuất

```text
orchestra.repo.list
orchestra.repo.register
orchestra.work.create
orchestra.work.list
orchestra.work.show
orchestra.work.plan
orchestra.work.enqueue
orchestra.job.show
orchestra.job.logs
orchestra.job.cancel
orchestra.job.retry
orchestra.approval.list
orchestra.approval.approve
orchestra.approval.reject
orchestra.worker.list
orchestra.evidence.show
orchestra.lesson.propose
```

#### Tool permission

```text
viewer:
  - repo.list
  - work.list
  - work.show
  - job.show
  - job.logs

operator:
  - work.create
  - work.plan
  - work.enqueue
  - job.retry
  - approval.approve/reject

admin:
  - repo.register
  - worker.manage
  - config.write
```

#### Acceptance criteria

- Hermes token gọi được MCP tools theo role.
- Tool response có structured JSON.
- Mọi write action có audit event.
- Tool không expose secret.

---

### P2.3. Hermes AI PM Workflow

#### Workflow mẫu

```text
User: Build feature X
  -> Hermes analyze goal
  -> Hermes create WorkItem
  -> Orchestra assess risk
  -> Orchestra build task graph
  -> Hermes review plan
  -> User approve
  -> Orchestra enqueue graph nodes
  -> Worker executes with Codex
  -> Checks run
  -> Evidence collected
  -> Hermes summarizes result
  -> User approve PR
```

#### Report format Hermes nên trả

```markdown
# Work Item Report

## Status
completed / blocked / failed

## Summary
...

## Changed Files
...

## Evidence
- typecheck: passed
- tests: passed
- review: passed

## Risks
...

## Next Actions
...
```

---

## 7. Phase P3 — Production/Team Readiness

> Mục tiêu: đủ ổn để team nhỏ dùng chung.

### P3.1. Postgres Adapter

Chỉ làm khi SQLite bắt đầu hạn chế.

#### Khi nào cần Postgres?

- Nhiều server instance.
- Nhiều user/team cùng dùng.
- Cần remote dashboard ổn định.
- Cần audit/report dài hạn.
- Cần query metrics nâng cao.

#### Không nên làm quá sớm

Với nhu cầu local-first, SQLite là đủ cho giai đoạn đầu.

---

### P3.2. OIDC/SAML hoặc OAuth

#### Thứ tự

```text
Shared token
  -> named tokens
  -> local user/password
  -> OAuth/OIDC
  -> SAML enterprise nếu cần
```

### P3.3. Metrics/Observability

#### Metrics cần có

```text
job_success_rate
job_failure_rate
avg_wait_time
avg_execution_time
worker_online_count
worker_busy_count
provider_success_rate
provider_avg_cost
approval_wait_time
stalled_job_count
```

#### Dashboard panels

```text
System Health
Worker Health
Queue Health
Provider Performance
Cost/Budget
Recent Failures
Lessons Proposed
```

---

## 8. CI/CD và Quality Gates

### 8.1. Check all command

Thêm script:

```json
{
  "scripts": {
    "check:all": "pnpm run typecheck && pnpm run lint && pnpm test && pnpm run dashboard:build && pnpm run dashboard:smoke && git diff --check"
  }
}
```

### 8.2. CI workflow nên có

```text
install
  -> typecheck
  -> lint
  -> unit tests
  -> server smoke
  -> worker smoke
  -> dashboard build
  -> dashboard smoke
  -> audit
```

### 8.3. Smoke test matrix

```text
ORCHESTRA_STORE=file
ORCHESTRA_STORE=sqlite
ORCHESTRA_EXECUTION_BACKEND=in-process
ORCHESTRA_EXECUTION_BACKEND=worker
ORCHESTRA_WORKER_PROVIDER=dummy
```

---

## 9. Backlog chi tiết cho Codex triển khai

### Epic 1 — SQLite Store

#### Task 1.1

```text
Create OrchestraStore abstraction and keep FileBacked implementation compatible.
```

#### Task 1.2

```text
Add SQLite dependency and migration runner.
```

#### Task 1.3

```text
Implement SqliteJobRepository with enqueue/list/get/update/cancel/delete.
```

#### Task 1.4

```text
Implement SqliteWorkerRepository and lease repository.
```

#### Task 1.5

```text
Add ORCHESTRA_STORE=file|sqlite config and tests for both modes.
```

---

### Epic 2 — Worker Supervisor

#### Task 2.1

```text
Create WorkerProcessSupervisor interface and dummy implementation.
```

#### Task 2.2

```text
Wrap CodexProvider execution with supervisor timeout/log capture.
```

#### Task 2.3

```text
Add periodic worker log upload to server.
```

#### Task 2.4

```text
Add hard timeout and process kill handling.
```

#### Task 2.5

```text
Add worker crash/stale lease integration tests.
```

---

### Epic 3 — Dashboard Smoke

#### Task 3.1

```text
Add Playwright setup for dashboard.
```

#### Task 3.2

```text
Add dashboard smoke test with mocked or dummy server state.
```

#### Task 3.3

```text
Add full server + dashboard smoke test.
```

#### Task 3.4

```text
Upload screenshot/video artifacts on CI failure.
```

---

### Epic 4 — Workspace Engine v1

#### Task 4.1

```text
Persist WorkItem in store.
```

#### Task 4.2

```text
Add work item API routes and CLI commands.
```

#### Task 4.3

```text
Implement deterministic task graph builder.
```

#### Task 4.4

```text
Link job result to work item evidence checklist.
```

#### Task 4.5

```text
Add dashboard WorkItem detail timeline and graph view.
```

---

### Epic 5 — Hermes MCP

#### Task 5.1

```text
Define Hermes MCP tool schemas.
```

#### Task 5.2

```text
Implement read-only tools first: repo.list, work.list, work.show, job.show, job.logs.
```

#### Task 5.3

```text
Implement operator tools: work.create, work.enqueue, job.retry, approval.approve/reject.
```

#### Task 5.4

```text
Add token-role permission tests for all MCP tools.
```

#### Task 5.5

```text
Add Hermes workflow example documentation.
```

---

## 10. Rủi ro kỹ thuật và cách xử lý

### 10.1. AI CLI không ổn định

#### Rủi ro

Codex/Claude/Agy CLI có thể thay đổi output, treo, yêu cầu login lại hoặc fail không rõ.

#### Giải pháp

- Provider adapter phải normalize output.
- Timeout bắt buộc.
- Capture raw logs.
- Doctor command kiểm tra login/provider trước.
- Fallback provider nếu adapter fail.

---

### 10.2. Job mutate filesystem rồi worker chết

#### Rủi ro

Repo chính có thể dirty hoặc worktree dở dang.

#### Giải pháp

- Mọi worker job chạy trong isolated git worktree.
- Checkpoint `filesystemMutated=true` sau khi bắt đầu ghi.
- Nếu lease expire sau mutation thì job chuyển `stalled`.
- Recover cần manual/operator action.

---

### 10.3. Hermes over-automation

#### Rủi ro

Hermes tự enqueue quá nhiều task hoặc approve sai.

#### Giải pháp

- Hermes không có admin permission mặc định.
- High-risk task bắt buộc human approval.
- Budget limit theo ngày/task.
- Rate limit MCP write tools.
- Audit mọi action.

---

### 10.4. Dashboard/API lệch schema

#### Rủi ro

Backend đổi field làm dashboard hỏng.

#### Giải pháp

- Shared API types.
- Contract tests.
- Dashboard smoke.
- Schema version trong response.

---

## 11. Thứ tự triển khai khuyến nghị

### Sprint 1 — Reliability baseline

```text
1. SQLite store abstraction
2. Migration runner
3. Job repository SQLite
4. Worker/lease SQLite
5. Store mode test matrix
```

### Sprint 2 — Worker hardening

```text
1. WorkerProcessSupervisor
2. Provider timeout/log capture
3. Stale lease integration tests
4. Worktree cleanup policy
5. Worker health dashboard polish
```

### Sprint 3 — Dashboard confidence

```text
1. Playwright setup
2. Dashboard smoke test
3. Server + dashboard e2e smoke
4. CI artifacts
5. check:all command
```

### Sprint 4 — Workspace Engine v1

```text
1. WorkItem persistence
2. Task graph v1
3. Evidence checklist
4. Work item dashboard
5. Job-to-work linkage
```

### Sprint 5 — Hermes integration

```text
1. MCP read tools
2. MCP write tools with permissions
3. Hermes workflow docs
4. AI PM report format
5. End-to-end Hermes -> Orchestra -> Worker smoke
```

---

## 12. Definition of Done cho v1.0 nội bộ

Orchestra có thể coi là v1.0 nội bộ khi đạt các điều kiện sau:

```text
[ ] SQLite store chạy ổn và là default cho server mode
[ ] File store vẫn còn để dev/simple mode
[ ] Worker claim/lease/recover có integration test
[ ] Provider process có timeout/log/kill handling
[ ] Dashboard smoke test chạy trong CI
[ ] Work item có task graph + evidence checklist
[ ] Job result link được về work item
[ ] Approval gate hoạt động từ dashboard/API
[ ] Hermes MCP read/write tools có permission test
[ ] check:all pass xanh
[ ] Có runbook vận hành server + worker
[ ] Có guide recover stalled job
[ ] Có guide rotate token
```

---

## 13. Kết luận

Update hiện tại của Orchestra AI Platform đã đúng hướng. Việc quan trọng nhất bây giờ không phải thêm thật nhiều feature AI mới, mà là **làm nền execution thật chắc**.

Thứ tự nên ưu tiên:

```text
1. SQLite durable state
2. Worker process supervisor
3. Dashboard smoke test
4. Workspace Engine v1
5. Hermes MCP integration
```

Sau khi hoàn thành 5 nhóm này, Orchestra sẽ đủ vững để đóng vai trò:

> Execution Engine cho Hermes Agent — nơi Hermes quản lý mục tiêu/work item, còn Orchestra chịu trách nhiệm chạy job, kiểm soát rủi ro, audit, evidence và worker execution.
