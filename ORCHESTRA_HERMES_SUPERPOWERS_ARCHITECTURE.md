# Kiến trúc mới cho Orchestra-AI-Platform: Hermes Agent + Superpowers + Local Worker

> Tài liệu này dùng làm đầu vào cho Codex triển khai.  
> Mục tiêu: biến Orchestra-AI-Platform thành **AI Workspace Control Plane** có Hermes làm AI PM/gateway, Superpowers làm workflow policy, và Local Worker làm nơi thực thi code/test an toàn.

---

## 0. Bối cảnh hiện tại

Repo hiện tại đã có nền tảng khá tốt:

- Orchestra là **local-first control plane for AI coding agents**.
- Có CLI, HTTP API, dashboard, job queue, artifact tracking, audit log.
- Có provider routing cho Codex, Antigravity, Claude và OpenAI-compatible API.
- Có workflow chính: `Task → Plan → Context → Generate → Verify → Review → PR/Deliver`.
- Workspace Engine đang ở trạng thái preview, đã có durable work items, branch tracking, PR planning; các phần dynamic task graph, evidence checklist và full CI auto-repair loop vẫn là roadmap.
- Server API hiện đã có `/jobs`, `/jobs/:id`, `/jobs/:id/stream`, `/jobs/:id/approve`, `/jobs/:id/cancel`, `/health`, `/stats`, `/audit`.

Tài liệu này đề xuất mở rộng repo theo hướng:

```txt
Hermes Agent = AI PM / memory / gateway / automation
Orchestra API = source of truth / job-control plane
Orchestra Worker = local execution runtime
Superpowers = workflow methodology pack
Codex / Claude / Antigravity = execution providers
```

---

## 1. Mục tiêu kiến trúc mới

### 1.1. Mục tiêu chính

Xây dựng kiến trúc để:

1. Hermes Agent chạy trên server/VPS, nhận yêu cầu tự nhiên từ user.
2. Hermes gọi Orchestra qua HTTP API hoặc MCP.
3. Orchestra API quản lý work item, job, approval, trạng thái, artifact, audit.
4. Local Worker chạy trên MacBook/Mac mini/Ubuntu build machine để thực thi task thật.
5. Worker gọi Codex/Claude/Antigravity để sửa code, chạy test, build, self-repair.
6. Superpowers được tích hợp dưới dạng `workflow profile`, không chạy như service riêng.
7. Kết quả được trả ngược về Hermes để báo cáo và lưu lesson/memory.

### 1.2. Không làm trong phase đầu

Không làm ngay:

- Không để Hermes trực tiếp sửa code.
- Không để server tự SSH vào máy Mac.
- Không bắt buộc full Kubernetes.
- Không bắt buộc Postgres ở phase đầu nếu file-backed store hiện tại vẫn dùng được.
- Không triển khai CI auto-repair đầy đủ ngay từ đầu.
- Không đưa toàn bộ source code lên server nếu task cần môi trường local.

---

## 2. Mô hình triển khai khuyến nghị

### 2.1. Production mini setup

```txt
SERVER / VPS / HOME SERVER
  - Hermes Agent
  - Orchestra API Server
  - Dashboard
  - Database / File Store
  - Queue
  - Artifact metadata
  - Audit log

MACBOOK / MAC MINI / BUILD MACHINE
  - Orchestra Local Worker
  - Codex CLI
  - Claude CLI
  - Antigravity CLI / IDE bridge
  - Git repos
  - Xcode / Android SDK / Docker / Node / pnpm

GITHUB / GITLAB
  - source code
  - branches
  - pull requests
  - CI
```

### 2.2. Mermaid diagram

```mermaid
flowchart TD
    U[User / Telegram / Web UI] --> H[Hermes Agent Server]

    H -->|HTTP API or MCP| OA[Orchestra API Server]
    OA --> DB[(Database or File Store)]
    OA --> Q[Job Queue]
    OA --> AD[Audit Log]
    OA --> AR[Artifact Metadata]

    Q -->|poll / websocket / sse| W1[Local Worker: MacBook]
    Q -->|optional| W2[Worker: Mac mini]
    Q -->|optional| W3[Worker: Ubuntu Server]

    W1 --> CX[Codex CLI]
    W1 --> CL[Claude CLI]
    W1 --> AG[Antigravity]
    W1 --> SP[Superpowers Workflow Profile]

    W1 --> REPO[Local Git Repos]
    W1 --> TEST[Lint / Typecheck / Test / Build]
    W1 --> DIFF[Diff / Patch / Commit / PR]

    DIFF --> OA
    TEST --> OA
    OA --> H
    H --> U
```

### 2.3. Nguyên tắc quan trọng

Worker phải **chủ động connect ra server**:

```txt
Local Worker ---> Orchestra API Server
```

Không làm chiều ngược lại:

```txt
Orchestra Server ---> SSH vào MacBook
```

Lý do:

- Không cần mở port trên MacBook.
- Dùng được sau NAT/router.
- An toàn hơn.
- Dễ chạy ở nhà, công ty, hoặc nhiều network khác nhau.

---

## 3. Trách nhiệm từng thành phần

## 3.1. Hermes Agent

Hermes là AI PM/gateway.

Nhiệm vụ:

- Nhận yêu cầu tự nhiên từ user.
- Nhớ context dài hạn.
- Theo dõi task.
- Gọi Orchestra API/MCP để tạo và chạy work item.
- Hỏi lại user khi cần business clarification.
- Báo cáo kết quả.
- Lưu lesson sau job.

Hermes không nên:

- Không trực tiếp sửa file trong repo.
- Không trực tiếp chạy `git commit`, `pnpm test`, `xcodebuild`.
- Không tự bypass approval của Orchestra.
- Không tự giữ source of truth của job state.

## 3.2. Orchestra API Server

Orchestra API là source of truth.

Nhiệm vụ:

- Quản lý work item.
- Quản lý job.
- Quản lý worker.
- Quản lý trạng thái.
- Quản lý approval.
- Quản lý artifact.
- Quản lý audit log.
- Expose REST API và MCP tools.
- Đẩy job vào queue.
- Nhận kết quả từ worker.

## 3.3. Orchestra Local Worker

Worker là nơi làm việc thật.

Nhiệm vụ:

- Register với server.
- Poll job hoặc giữ WebSocket.
- Checkout repo.
- Tạo branch/worktree.
- Spawn Codex/Claude/Antigravity.
- Inject workflow instructions.
- Chạy verify commands.
- Self-repair theo giới hạn.
- Upload logs/artifacts.
- Chờ approval nếu cần.
- Commit/push/create PR nếu được duyệt.

## 3.4. Superpowers

Superpowers không nên chạy như service riêng trong phase đầu.

Nên tích hợp thành:

```txt
Workflow Profile / Methodology Pack
```

Ví dụ:

```txt
default
fast-fix
balanced
superpowers
strict-review
```

`superpowers` mode ép workflow:

- Check current work trước.
- Brainstorm nếu task chưa rõ.
- Viết spec trước khi sửa code.
- Viết plan trước execution.
- Dùng git worktree/branch riêng.
- Ưu tiên test-first nếu phù hợp.
- Evidence over claims.
- Review trước khi deliver.

## 3.5. Codex / Claude / Antigravity

Các provider này là worker AI cấp thấp.

Vai trò đề xuất:

```txt
Planner: Claude hoặc Antigravity
Generator: Codex hoặc Claude
Fixer: Codex
Reviewer: Claude hoặc strict-reviewer plugin
Summarizer: provider rẻ hơn
```

Không hard-code. Dùng Provider Router hiện có để quyết định theo profile.

---

## 4. Deployment mode

## 4.1. Mode A: All-in-one local

Dùng cho development.

```txt
MacBook:
  - Hermes optional
  - Orchestra API
  - Dashboard
  - Worker
  - Codex/Claude/Antigravity
```

Ưu điểm:

- Dễ debug.
- Không cần network phức tạp.
- Dễ test integration.

Nhược điểm:

- Tắt Mac là dừng.
- Không có AI PM 24/7.

## 4.2. Mode B: Server + local worker

Dùng cho production mini.

```txt
Server:
  - Hermes
  - Orchestra API
  - Dashboard
  - DB/Queue

MacBook/Mac mini:
  - Worker
  - coding tools
  - repos
```

Đây là mode khuyến nghị.

## 4.3. Mode C: Full server execution

Chỉ dùng cho backend/web/docker task.

```txt
Server:
  - Hermes
  - Orchestra API
  - Worker
  - repos
  - Docker
```

Không khuyến nghị cho React Native iOS vì cần Xcode/macOS.

---

## 5. Luồng xử lý end-to-end

### 5.1. Luồng chuẩn

```mermaid
sequenceDiagram
    participant U as User
    participant H as Hermes
    participant API as Orchestra API
    participant Q as Queue
    participant W as Local Worker
    participant AI as Codex/Claude/Antigravity
    participant G as Git Provider

    U->>H: "Fix React Native Hermes DevTools issue"
    H->>API: createWorkItem()
    API->>API: assess initial risk
    H->>API: executeWorkItem()
    API->>Q: enqueue job
    W->>API: claim next job lease
    API-->>W: job payload
    W->>W: create branch/worktree
    W->>AI: plan task
    AI-->>W: plan
    W->>API: upload plan artifact
    API-->>H: status planning_done

    alt approval required
        H-->>U: ask approval
        U->>H: approve
        H->>API: approveStep()
    end

    W->>AI: generate implementation
    AI-->>W: patch/diff
    W->>W: apply patch
    W->>W: run lint/typecheck/test/build

    alt verification failed
        W->>AI: repair with failure logs
        AI-->>W: fix patch
        W->>W: rerun checks
    end

    W->>API: upload final diff + test logs
    API-->>H: waiting final approval
    U->>H: approve deliver
    H->>API: approve deliver
    W->>G: push branch / create PR
    W->>API: complete job
    API-->>H: summary
    H-->>U: final report
```

### 5.2. State machine

```mermaid
stateDiagram-v2
    [*] --> created
    created --> assessing
    assessing --> planning
    planning --> waiting_plan_approval
    waiting_plan_approval --> executing: approved
    waiting_plan_approval --> cancelled: rejected

    planning --> executing: no approval required
    executing --> verifying
    verifying --> repairing: failed and retries left
    repairing --> verifying
    verifying --> reviewing: passed
    reviewing --> waiting_delivery_approval
    waiting_delivery_approval --> delivering: approved
    waiting_delivery_approval --> cancelled: rejected
    delivering --> completed
    verifying --> failed: failed and no retries left
    reviewing --> failed: blocking review issue
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

---

## 6. API thiết kế mới

Hiện repo đã có `/jobs` và `/work-items`. Có thể mở rộng theo hướng không phá vỡ API cũ.

### 6.0. Compatibility rule

Không thay route hiện có trong phase đầu.

Canonical routes hiện tại vẫn là:

```txt
/jobs
/jobs/:id
/jobs/:id/stream
/jobs/:id/approve
/jobs/:id/cancel
/work-items
/work-items/:id
/work-items/:id/assess
/work-items/:id/run
/work-items/:id/cancel
/work-items/:id/handoff
```

Nếu muốn expose namespace mới cho Hermes hoặc public API, thêm alias:

```txt
/api/jobs              -> /jobs
/api/work-items        -> /work-items
/api/work-items/:id    -> /work-items/:id
```

Rule:

- Dashboard và CLI hiện tại không phải migrate ngay.
- MCP tools gọi service layer nội bộ, không hard-code route path.
- Tài liệu API mới phải ghi rõ route nào là canonical và route nào là alias.
- Không đổi response shape của route cũ nếu chưa có versioning.
- Nếu response mới cần field mới, chỉ thêm field optional.

### 6.0.1. Compatibility normalizer

Vì phase đầu phải chấp nhận cả payload cũ và payload mới, cần một normalizer duy nhất ở service layer.

Không để từng route tự map field riêng.

```ts
export interface NormalizedWorkItemInput {
  title: string;
  description: string;
  cwd: string;
  projectId: string;
  type: WorkItemType;
  expectedOutput: ExpectedOutput;
  executionMode: ExecutionMode;
  workflowProfile: WorkflowProfileId;
  routingProfile?: RoutingProfile;
  requestedBy?: "cli" | "dashboard" | "hermes" | "api" | "mcp";
  metadata: Record<string, unknown>;
}
```

Normalizer rules:

```txt
payload.cwd                         -> cwd
payload.repo.localPath              -> cwd if payload.cwd absent
payload.workflow                    -> workflowProfile legacy alias
payload.workflowProfile             -> workflowProfile
payload.executionMode               -> executionMode
payload.mode                        -> execution mode only if it matches existing WorkflowMode values
missing executionMode               -> infer from type, default "standard"
missing workflowProfile             -> "default"
missing requestedBy                 -> infer from actor/source
```

Status normalization:

```txt
external/completed -> internal/done
external/verifying -> internal/running_checks
external/repairing -> internal/fixing_failures
external/delivering -> internal/committing|pushing|creating_pr based on substage
```

All dashboard, CLI, HTTP, and MCP entrypoints should call the same normalizer before persistence.

## 6.1. Work Items API

### Create work item

```http
POST /work-items
Authorization: Bearer <token>
Content-Type: application/json
```

Body:

```json
{
  "title": "Fix Android Hermes DevTools connection",
  "description": "React Native DevTools báo No compatible apps connected dù hermesEnabled=true",
  "repo": {
    "provider": "github",
    "owner": "nghiant96",
    "name": "CloudclassV5",
    "localPath": "/Users/trungnghianguyen/Documents/ISOFH/project-react-native-isofhcare-plus"
  },
  "executionMode": "fix",
  "workflowProfile": "superpowers",
  "routingProfile": "balanced",
  "riskLevel": "auto",
  "requestedBy": "hermes",
  "metadata": {
    "source": "telegram",
    "conversationId": "..."
  }
}
```

Compatibility mapping với WorkItem hiện tại:

```txt
repo.localPath -> cwd
repo.name      -> projectId fallback
workflow       -> workflowProfile
routingProfile -> routingProfile
requestedBy    -> source/requestedBy metadata
```

Trong phase đầu, server nên chấp nhận cả payload cũ và payload mới:

```json
{
  "title": "Fix Android Hermes DevTools connection",
  "description": "...",
  "cwd": "/Users/trungnghianguyen/Documents/ISOFH/project-react-native-isofhcare-plus",
  "type": "bugfix",
  "expectedOutput": "patch",
  "workflowProfile": "superpowers",
  "executionMode": "fix"
}
```

`repo.localPath` không được tin trực tiếp. Nó phải đi qua cùng guard `AI_SYSTEM_ALLOWED_WORKDIRS` như `cwd`.

Response:

```json
{
  "id": "wi_01HX...",
  "status": "created",
  "createdAt": "2026-06-01T00:00:00.000Z"
}
```

### Get work item

```http
GET /work-items/:id
```

### List work items

```http
GET /work-items?status=executing&limit=50
```

### Execute work item

```http
POST /work-items/:id/run
```

Body:

```json
{
  "workerSelector": {
    "os": "darwin",
    "labels": ["macbook", "react-native", "ios"]
  },
  "mode": "dry-run",
  "maxRepairIterations": 3
}
```

### Approve step

```http
POST /work-items/:id/approve
```

Body:

```json
{
  "step": "plan",
  "approvedBy": "user",
  "comment": "OK, triển khai theo plan này"
}
```

### Cancel

```http
POST /work-items/:id/cancel
```

Body:

```json
{
  "reason": "User cancelled"
}
```

---

## 6.2. Worker API

### Register worker

```http
POST /workers/register
```

Body:

```json
{
  "name": "nghia-macbook-worker",
  "version": "0.1.0",
  "os": "darwin",
  "arch": "arm64",
  "labels": ["macbook", "react-native", "ios", "android"],
  "capabilities": {
    "xcode": true,
    "androidSdk": true,
    "docker": true,
    "codex": true,
    "claude": true,
    "antigravity": true
  },
  "workspaceRoots": [
    "/Users/trungnghianguyen/Documents",
    "/Users/trungnghianguyen/FootballApp"
  ]
}
```

Response:

```json
{
  "workerId": "worker_01HX...",
  "sessionToken": "..."
}
```

### Heartbeat

```http
POST /workers/:workerId/heartbeat
```

Body:

```json
{
  "status": "idle",
  "currentJobId": null,
  "freeDiskGb": 120,
  "cpuLoad": 0.32,
  "timestamp": "2026-06-01T00:00:00.000Z"
}
```

### Claim next job

```http
POST /workers/:workerId/jobs/claim
```

Claim job phải là atomic lease operation, không chỉ là read-only poll.

Claim eligibility:

```txt
worker can claim job only if:
  - ORCHESTRA_EXECUTION_BACKEND is "worker" or "hybrid"
  - job.status is "queued"
  - job has no active unexpired lease
  - worker.status is "idle" or "online"
  - worker is not disabled or draining
  - worker labels match job.workerSelector.labels
  - worker capabilities satisfy job.requiredCapabilities
  - job repoLocalPath realpath is inside one of worker.workspaceRoots
  - job attempt count is below max attempts
```

This policy should live in `worker-service.ts` or an equivalent service layer, not inside route handlers.

Response:

```json
{
  "job": {
    "id": "job_01HX...",
    "workItemId": "wi_01HX...",
    "type": "execute_work_item",
    "payload": {
      "repoLocalPath": "/Users/trungnghianguyen/Documents/...",
      "task": "...",
      "executionMode": "fix",
      "workflowProfile": "superpowers",
      "routingProfile": "balanced"
    }
  },
  "lease": {
    "workerId": "worker_01HX...",
    "leaseId": "lease_01HX...",
    "claimedAt": "2026-06-01T00:00:00.000Z",
    "expiresAt": "2026-06-01T00:05:00.000Z",
    "lastHeartbeatAt": "2026-06-01T00:00:00.000Z"
  }
}
```

Nếu không có job phù hợp:

```json
{
  "job": null,
  "retryAfterMs": 3000
}
```

### Worker admin actions

```http
POST /workers/:workerId/disable
POST /workers/:workerId/enable
POST /workers/:workerId/drain
```

Semantics:

```txt
disable -> worker cannot claim new jobs and active lease should be cancelled or allowed to fail by policy
enable  -> worker can claim jobs again
drain   -> worker cannot claim new jobs, but current job may finish
```

All worker admin actions require operator permission and audit events.

### Upload logs

```http
POST /jobs/:jobId/logs
```

Body:

```json
{
  "level": "info",
  "stage": "verify",
  "message": "pnpm typecheck passed",
  "timestamp": "2026-06-01T00:00:00.000Z"
}
```

### Upload artifact

```http
POST /jobs/:jobId/artifacts
```

Body:

```json
{
  "type": "diff",
  "name": "final.diff",
  "contentType": "text/x-diff",
  "content": "...",
  "metadata": {
    "stage": "generation",
    "iteration": 1
  }
}
```

For large artifacts, later replace inline content with file upload / object storage.

### Complete job

```http
POST /jobs/:jobId/complete
```

Body:

```json
{
  "status": "completed",
  "summary": "Fixed Hermes DevTools config and verified Android debug build.",
  "artifacts": ["artifact_1", "artifact_2"],
  "evidence": [
    {
      "name": "typecheck",
      "status": "passed",
      "command": "pnpm typecheck"
    },
    {
      "name": "android-debug-build",
      "status": "passed",
      "command": "cd android && ./gradlew assembleDebug"
    }
  ]
}
```

### Fail job

```http
POST /jobs/:jobId/fail
```

Body:

```json
{
  "errorCode": "VERIFY_FAILED",
  "message": "Android build failed after 3 repair iterations",
  "lastLogsArtifactId": "artifact_123"
}
```

---

## 6.3. Events API

Use existing `/jobs/:id/stream` pattern and add work item stream.

```http
GET /work-items/:id/events
```

Server-Sent Events:

```txt
event: status
data: {"status":"planning","timestamp":"..."}

event: log
data: {"level":"info","message":"Running pnpm typecheck"}

event: artifact
data: {"artifactId":"artifact_123","type":"diff"}

event: approval_required
data: {"step":"plan","summary":"Plan ready for approval"}
```

---

## 7. MCP integration

MCP is not a replacement for the HTTP API. It is a wrapper so Hermes and other agents can call Orchestra as tools.

## 7.1. MCP tools

Create package/module:

```txt
ai-system/mcp/
  server.ts
  tools/
    create-work-item.ts
    run-work-item.ts
    get-status.ts
    get-artifacts.ts
    approve-step.ts
    cancel-work-item.ts
```

Tools:

```txt
orchestra_create_work_item
orchestra_run_work_item
orchestra_get_work_item
orchestra_get_events
orchestra_get_artifacts
orchestra_approve_step
orchestra_cancel_work_item
```

## 7.2. MCP tool schemas

### orchestra_create_work_item

Input:

```json
{
  "title": "string",
  "description": "string",
  "repo": {
    "provider": "github|gitlab|local",
    "owner": "string",
    "name": "string",
    "localPath": "string"
  },
  "executionMode": "standard|implement|review|fix|refactor",
  "workflowProfile": "default|fast-fix|balanced|superpowers|strict-review",
  "routingProfile": "balanced|quality|speed|cost",
  "labels": ["string"]
}
```

Output:

```json
{
  "workItemId": "string",
  "status": "created",
  "dashboardUrl": "string"
}
```

### orchestra_run_work_item

Input:

```json
{
  "workItemId": "string",
  "mode": "dry-run|write|pr",
  "workerLabels": ["string"]
}
```

Output:

```json
{
  "jobId": "string",
  "status": "queued"
}
```

### orchestra_get_status

Input:

```json
{
  "workItemId": "string"
}
```

Output:

```json
{
  "status": "executing",
  "stage": "verify",
  "summary": "Running typecheck",
  "requiresApproval": false
}
```

### orchestra_approve_step

Input:

```json
{
  "workItemId": "string",
  "step": "plan|generation|delivery",
  "artifactRefs": [
    {
      "artifactId": "artifact_123",
      "artifactType": "plan",
      "sha256": "..."
    }
  ],
  "approvedBy": {
    "type": "user",
    "id": "user_123",
    "name": "Nghia"
  },
  "approvalSource": "hermes",
  "userConfirmationId": "telegram_message_123",
  "comment": "string"
}
```

Output:

```json
{
  "approved": true
}
```

Hermes approval rule:

- Hermes cannot approve by itself in production policy.
- Hermes can only relay an explicit user confirmation.
- `userConfirmationId` must identify the user-visible confirmation event.
- Approval is rejected if artifact hashes no longer match pending approval.
- All approvals are audited with both `actor=hermes` and `approvedBy=user`.

## 7.3. MCP security rule

MCP tools must be deny-by-default:

- Only expose safe tools to Hermes.
- No raw shell execution tool through MCP.
- No arbitrary file read/write through MCP.
- All write/delivery actions require Orchestra-side policy check.
- All approval actions require actor identity.

---

## 8. Data model

Phase đầu có thể dùng file-backed store hiện tại. Nhưng thiết kế nên map được sang SQLite/Postgres.

## 8.1. WorkItem

Repo hiện tại đã có `WorkItem` preview. Không thay schema cũ bằng schema mới trong một bước.

Compatibility strategy:

```txt
schemaVersion hiện tại -> giữ nguyên và tăng có kiểm soát nếu cần
status hiện tại        -> giữ backward-compatible
field mới             -> thêm optional
dashboard hiện tại     -> phải render được cả item cũ và item mới
```

Status hiện tại trong repo gồm:

```txt
created
assessing
decomposing
planning
waiting_plan_approval
executing
running_checks
fixing_failures
reviewing
waiting_generation_approval
committing
pushing
creating_pr
watching_ci
ready_for_review
done
failed
cancelled
```

Status mới trong tài liệu này chỉ nên được dùng nếu có migration/mapping rõ ràng:

```txt
queued       -> existing job.status = queued, không nhất thiết là WorkItemStatus
verifying    -> running_checks
repairing    -> fixing_failures
delivering   -> committing/pushing/creating_pr
completed    -> done
```

Recommendation:

- Giữ `WorkItemStatus` hiện tại ở phase đầu.
- Thêm `stage?: "queued" | "verifying" | "repairing" | "delivering"` nếu cần hiển thị trạng thái chi tiết.
- Không rename `done` thành `completed` cho tới khi dashboard, CLI, store normalizer và docs cùng migrate.

```ts
export type WorkItemStatus =
  | "created"
  | "assessing"
  | "decomposing"
  | "planning"
  | "waiting_plan_approval"
  | "executing"
  | "running_checks"
  | "fixing_failures"
  | "reviewing"
  | "waiting_generation_approval"
  | "committing"
  | "pushing"
  | "creating_pr"
  | "watching_ci"
  | "ready_for_review"
  | "done"
  | "failed"
  | "cancelled";

export type WorkItemStage =
  | "queued"
  | "verifying"
  | "repairing"
  | "delivering";

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  stage?: WorkItemStage;

  repo: RepoRef;

  executionMode?: ExecutionMode;
  workflowProfile?: WorkflowProfileId;
  routingProfile: RoutingProfile;
  riskLevel: "auto" | "low" | "medium" | "high";

  createdBy: ActorRef;
  requestedBy?: "cli" | "dashboard" | "hermes" | "api" | "mcp";

  currentJobId?: string;
  branchName?: string;
  prUrl?: string;

  assessment?: Assessment;
  plan?: ExecutionPlan;
  evidenceChecklist?: EvidenceItem[];

  createdAt: string;
  updatedAt: string;
}
```

## 8.2. RepoRef

```ts
export interface RepoRef {
  provider: "github" | "gitlab" | "local";
  owner?: string;
  name: string;
  remoteUrl?: string;
  localPath?: string;
  defaultBranch?: string;
}
```

## 8.3. Worker

```ts
export interface Worker {
  id: string;
  name: string;
  version: string;
  os: "darwin" | "linux" | "windows";
  arch: string;
  labels: string[];

  capabilities: {
    codex?: boolean;
    claude?: boolean;
    antigravity?: boolean;
    docker?: boolean;
    xcode?: boolean;
    androidSdk?: boolean;
    node?: boolean;
    pnpm?: boolean;
  };

  workspaceRoots: string[];
  status: "online" | "offline" | "idle" | "busy" | "disabled";
  currentJobId?: string;

  lastHeartbeatAt: string;
  createdAt: string;
}
```

## 8.4. Job

```ts
export interface Job {
  id: string;
  workItemId: string;
  workerId?: string;

  type: "execute_work_item" | "verify" | "review" | "deliver";
  status:
    | "queued"
    | "assigned"
    | "running"
    | "waiting_approval"
    | "completed"
    | "failed"
    | "cancelled"
    | "stalled";

  payload: Record<string, unknown>;
  result?: JobResult;

  createdAt: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;

  lease?: JobLease;
  attempt?: number;
}
```

## 8.4.1. JobLease

Local Worker phải claim job bằng lease. Đây là phần bắt buộc để tránh job chạy trùng hoặc kẹt sau khi laptop sleep/network drop.

```ts
export interface JobLease {
  workerId: string;
  leaseId: string;
  claimedAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
}
```

Lease rules:

- `claim` là atomic: chỉ một worker chuyển được job từ `queued` sang `assigned`.
- Worker phải gửi `leaseId` khi `heartbeat`, `complete`, hoặc `fail`.
- Server từ chối `complete/fail` nếu `leaseId` không còn hợp lệ.
- Nếu `expiresAt < now`, job chuyển sang `stalled` hoặc quay lại `queued` tùy policy.
- Reassign chỉ tự động cho job chưa apply patch hoặc job có checkpoint an toàn.
- `attempt` tăng sau mỗi lần reclaim để tránh retry vô hạn.
- In-process server runner hiện tại vẫn có thể chạy như một worker nội bộ trong dev mode.

Lease state machine:

```txt
queued
  -> assigned        claim created
assigned
  -> running         worker marks started with valid leaseId
assigned|running
  -> stalled         lease expires and job is not safe to auto-requeue
assigned|running
  -> queued          lease expires and job is safe to reassign
running
  -> waiting_approval approval gate pauses execution, lease remains active or is explicitly released
waiting_approval
  -> running         approval accepted and worker reacquires/renews lease
running
  -> completed       worker completes with valid leaseId
running
  -> failed          worker fails with valid leaseId
queued|assigned|running|waiting_approval
  -> cancelled       operator/user cancels
```

Mutation and reassign rules:

```txt
safe_to_reassign = job has not modified filesystem and has no uncommitted patch application
stalled_required = job may have modified files, spawned provider process, or started delivery
```

Worker must send mutation checkpoints:

```json
{
  "jobId": "job_01HX...",
  "leaseId": "lease_01HX...",
  "stage": "apply_patch",
  "filesystemMutated": true,
  "worktreePath": "/Users/.../repo-orchestra-wi_123"
}
```

Server behavior:

- Before first mutation, expired lease may return to `queued`.
- After first mutation, expired lease becomes `stalled` and requires manual resume/cleanup.
- `complete` and `fail` are idempotent for the same `leaseId` and terminal result.
- `complete` after lease expiry is rejected unless the job has not been reclaimed and policy allows grace completion.
- Reclaim must never run two workers against the same worktree.

## 8.5. Artifact

```ts
export interface Artifact {
  id: string;
  workItemId: string;
  jobId?: string;
  leaseId?: string;

  type:
    | "plan"
    | "diff"
    | "patch"
    | "log"
    | "test-result"
    | "review"
    | "summary"
    | "pr";

  name: string;
  contentType: string;

  storage: {
    kind: "inline" | "file" | "object";
    value: string;
  };

  sha256: string;
  sizeBytes: number;
  immutable: boolean;
  createdBy: ActorRef;
  metadata: Record<string, unknown>;
  createdAt: string;
}
```

Artifact integrity rules:

- Artifact content is immutable after creation.
- Any correction creates a new artifact version, never overwrites the old one.
- Every artifact stores `sha256`, `sizeBytes`, `createdBy`, `jobId`, and when applicable `leaseId`.
- Approval must reference artifact id and hash, not just a stage name.
- Large artifacts use file/object storage, but the metadata and hash stay in the authoritative store.
- Logs and prompts must pass redaction before hashing/uploading so stored artifacts do not contain raw secrets.
- Dashboard must display when an approval points to a stale artifact version.

## 8.6. Approval

```ts
export interface Approval {
  id: string;
  workItemId: string;
  jobId?: string;
  leaseId?: string;

  step: "plan" | "generation" | "delivery" | "high_risk_action";
  status: "pending" | "approved" | "rejected";
  requestedReason: string;
  artifactRefs: ApprovalArtifactRef[];

  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: ActorRef;
  approvalSource?: "dashboard" | "cli" | "hermes" | "mcp" | "api";
  userConfirmationId?: string;
  comment?: string;
}

export interface ApprovalArtifactRef {
  artifactId: string;
  artifactType: "plan" | "diff" | "review" | "summary" | "pr";
  sha256: string;
}
```

Approval rules:

- Approval is valid only for the exact artifact refs and hashes it names.
- If worker regenerates a plan/diff after approval, previous approval becomes stale.
- Delivery approval must reference final diff, verification evidence, and PR summary artifacts.
- Hermes/MCP may submit approval only as a relay of a user decision, not as autonomous self-approval, unless policy explicitly allows it.
- Approval request should include enough context for UI/Hermes to show what is being approved without reading mutable worker state.

## 8.7. AuditEvent

```ts
export interface AuditEvent {
  id: string;
  actor: ActorRef;
  action: string;
  targetType: "work_item" | "job" | "worker" | "artifact" | "approval" | "config";
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
```

---

## 9. Worker runtime design

## 9.1. Worker command

Add CLI command:

```bash
pnpm ai worker start \
  --server http://localhost:3000 \
  --name nghia-macbook-worker \
  --labels macbook,react-native,ios,android \
  --workspace-root /Users/trungnghianguyen/Documents
```

Or env:

```env
ORCHESTRA_SERVER_URL=http://server-ip:3000
ORCHESTRA_WORKER_TOKEN=...
ORCHESTRA_WORKER_NAME=nghia-macbook-worker
ORCHESTRA_WORKER_LABELS=macbook,react-native,ios,android
ORCHESTRA_WORKSPACE_ROOTS=/Users/trungnghianguyen/Documents,/Users/trungnghianguyen/FootballApp
```

## 9.2. Worker loop

Pseudo-code:

```ts
async function startWorker() {
  const worker = await registerWorker();

  let activeLease: JobLease | null = null;

  setInterval(() => sendHeartbeat(worker.id, activeLease), 10_000);

  while (!shuttingDown) {
    const claimed = await claimNextJob(worker.id);

    if (!claimed.job) {
      await sleep(3000);
      continue;
    }

    activeLease = claimed.lease;

    try {
      await markJobStarted(claimed.job.id, activeLease.leaseId);
      const result = await executeJob(claimed.job);
      await completeJob(claimed.job.id, activeLease.leaseId, result);
    } catch (err) {
      await failJob(claimed.job.id, activeLease.leaseId, serializeError(err));
    } finally {
      activeLease = null;
    }
  }
}
```

Worker loop requirements:

- Claim must include worker labels/capabilities and workspace roots.
- Heartbeat must renew active lease while a job is running.
- Worker shutdown should mark current lease as releasing if no filesystem mutation is in progress.
- Server must make `completeJob` and `failJob` idempotent for repeated network retries with the same `leaseId`.
- Worker must never execute a job whose `repoLocalPath` is outside configured workspace roots, even if server assigned it.

## 9.2.1. Execution backend mode

Server must have an explicit execution backend setting so dev/prod behavior is not ambiguous.

```env
ORCHESTRA_EXECUTION_BACKEND=in-process
```

Allowed values:

```txt
in-process   server queue runs jobs using the existing in-process runner
worker       server only stores/assigns jobs; local workers execute
hybrid       server may run jobs only when workerSelector allows internal worker
```

Rules:

- Default local development can remain `in-process`.
- Production mini setup should use `worker`.
- `hybrid` must model the server runner as an internal worker with labels and leases.
- A job must have exactly one execution owner at a time.
- Queue tests must cover at least `in-process` and `worker` modes.
- Dashboard health should show the active backend mode.

## 9.3. Worker safety checks

Before executing job:

- Ensure `repoLocalPath` is inside allowed `workspaceRoots`.
- Refuse paths with `..`.
- Refuse symlink escape outside root unless explicitly allowed.
- Check git working tree status.
- If dirty tree exists, require policy:
  - abort, or
  - create patch backup artifact, or
  - use separate worktree.
- Never read `.env`, private key files, signing certs into prompt.
- Redact known secret patterns from logs.

Security enforcement must not rely on prompt policy alone.

Enforcement layers:

```txt
1. Server assignment policy
   - workerSelector must match labels/capabilities
   - repo path must be under allowed server workspace roots
   - high-risk task must create approval gate before mutation

2. Worker path policy
   - resolve realpath for repo/worktree
   - reject symlink escape
   - deny writes outside worktree
   - deny prompt context collection from secret paths

3. Worker command policy
   - wrap all configured verification commands
   - block forbidden commands before spawn
   - require approval for destructive commands
   - record command, cwd, exit code, duration, and redacted output

4. Provider sandbox contract
   - provider CLIs run in the prepared worktree
   - provider environment is minimized
   - secrets are not passed unless explicitly allowed
   - generated patches are reviewed before apply when workflowProfile requires approval

5. Artifact/log scrubber
   - redact before upload
   - store raw local transcripts only if policy allows
   - mark artifacts as scrubbed/untrusted in metadata
```

Minimum phase-one enforcement:

- path realpath guard
- deny secret files in context collection
- command denylist for obviously destructive commands
- log redaction before upload
- worktree isolation for write mode

## 9.4. Git worktree strategy

Recommended for safe execution:

```bash
git fetch origin
git worktree add ../repo-orchestra-wi_123 -b orchestra/wi_123 origin/main
```

Branch naming:

```txt
orchestra/<workItemId>-short-title
```

Examples:

```txt
orchestra/wi_01hx-fix-hermes-devtools
orchestra/wi_01hy-codepush-job-store
```

## 9.5. Execution stages inside Worker

```txt
1. prepare_workspace
2. collect_context
3. plan
4. maybe_wait_plan_approval
5. generate
6. apply_patch
7. verify
8. repair_loop
9. review
10. maybe_wait_delivery_approval
11. deliver
12. summarize
```

---

## 10. Superpowers workflow profile

## 10.1. Split execution mode from workflow profile

Repo hiện tại đã có `WorkflowMode` dùng cho execution behavior:

```ts
export type ExecutionMode =
  | "standard"
  | "implement"
  | "review"
  | "fix"
  | "refactor";
```

Không nên thay type này bằng `default|fast-fix|balanced|superpowers|strict-review`, vì các mode hiện tại đang được CLI/server/orchestrator dùng để quyết định dry-run, approval và prompt role.

Thêm khái niệm mới:

```ts
export type WorkflowProfileId =
  | "default"
  | "fast-fix"
  | "balanced"
  | "superpowers"
  | "strict-review";
```

Rule:

```txt
executionMode    = cách chạy task ở runtime
workflowProfile  = policy/methodology áp lên task
routingProfile   = chọn provider/model/cost path
```

Ví dụ:

```json
{
  "executionMode": "fix",
  "workflowProfile": "superpowers",
  "routingProfile": "balanced"
}
```

Precedence rules:

```txt
1. Risk policy is the floor. A workflow profile cannot reduce required approvals or checks from risk classification.
2. executionMode controls runtime intent and base flags: dryRun, interactive, pauseAfterPlan, pauseAfterGenerate.
3. workflowProfile can only tighten guardrails unless explicitly marked as an admin override.
4. routingProfile chooses provider/model/cost path and cannot bypass approval or security policy.
5. User/API explicit flags may tighten behavior; they cannot weaken risk policy or workflowProfile requirements without admin permission.
```

Example conflict resolution:

```txt
executionMode=implement + workflowProfile=superpowers
  -> write mode may be allowed, but plan approval and delivery approval remain required.

executionMode=review + workflowProfile=fast-fix
  -> dry-run/review defaults remain unless user explicitly requests write and policy allows it.
```

Dry-run/write/pr mode contract:

```txt
missing mode         -> dry-run
mode=dry-run         -> no filesystem mutation, no push, no PR creation
mode=write           -> may apply patch only after required plan/generation approval
mode=pr              -> may push/create PR only after delivery approval
workflowProfile      -> may force additional approvals before mutation/delivery
riskPolicy           -> may force approval regardless of mode
```

## 10.2. Workflow config

Create:

```txt
ai-system/workflows/
  workflow-modes.ts
  profiles/
    default.ts
    fast-fix.ts
    balanced.ts
    superpowers.ts
    strict-review.ts
```

Example:

```ts
export const superpowersWorkflow: WorkflowProfile = {
  id: "superpowers",
  displayName: "Superpowers",
  description: "Spec-first, plan-first, evidence-driven AI coding workflow.",

  requireCleanGitTree: true,
  requireWorktree: true,
  requireSpecBeforeCode: true,
  requirePlanBeforeExecution: true,
  requirePlanApproval: true,
  requireDeliveryApproval: true,

  verification: {
    requireEvidence: true,
    maxRepairIterations: 3,
    runCommands: "auto"
  },

  promptPolicy: {
    includeMethodologyInstructions: true,
    includeEvidenceChecklist: true,
    forbidUnverifiedClaims: true
  },

  reviewPolicy: {
    required: true,
    reviewerRole: "reviewer",
    blockOnHighSeverity: true
  }
};
```

## 10.3. Superpowers prompt block

Inject into planner/generator/reviewer prompts when `workflowProfile = "superpowers"`:

```txt
You are working under Orchestra Superpowers Workflow.

Rules:
1. Do not implement before writing a plan.
2. Prefer small, reversible changes.
3. Use evidence over claims.
4. Every completed task must include commands run and outputs observed.
5. If tests fail, explain the failure and repair using the logs.
6. Do not touch unrelated files.
7. Do not read or expose secrets.
8. If requirements are ambiguous, produce assumptions and mark them clearly.
9. For high-risk changes, request approval before writing.
10. Final response must include: changed files, verification evidence, remaining risks.
```

## 10.4. Evidence checklist

```ts
export interface EvidenceItem {
  id: string;
  name: string;
  required: boolean;
  status: "pending" | "passed" | "failed" | "skipped";
  command?: string;
  artifactId?: string;
  notes?: string;
}
```

Default checklist:

```txt
- Plan artifact exists
- Diff artifact exists
- Typecheck executed or explicitly skipped with reason
- Lint executed or explicitly skipped with reason
- Test/build executed or explicitly skipped with reason
- AI review completed
- Human approval captured if required
```

---

## 11. Hermes integration

## 11.1. Hermes should call Orchestra, not replace it

Hermes role:

```txt
Natural language intent -> WorkItem creation -> Status tracking -> User report -> Lesson memory
```

Orchestra role:

```txt
WorkItem source of truth -> Worker assignment -> Safe execution -> Verification -> Approval -> PR
```

## 11.2. Hermes-to-Orchestra flow

```txt
Hermes receives user request
  -> Extract task title/description/repo/risk
  -> Call orchestra_create_work_item
  -> Call orchestra_run_work_item
  -> Subscribe/poll status
  -> Notify user when approval required
  -> Call orchestra_approve_step only after user approves
  -> Summarize final result
  -> Save lesson/memory
```

## 11.3. Lesson export format

After each completed/failed job, Orchestra should expose:

```json
{
  "workItemId": "wi_123",
  "title": "Fix Hermes DevTools connection",
  "repo": "CloudclassV5",
  "status": "completed",
  "failurePatterns": [
    "React Native DevTools requires Hermes runtime attached",
    "Android debug build may still use stale Metro cache"
  ],
  "successfulFixes": [
    "Verified hermesEnabled=true",
    "Reset Metro cache",
    "Checked device logcat for Hermes runtime"
  ],
  "commandsThatPassed": [
    "pnpm typecheck",
    "cd android && ./gradlew assembleDebug"
  ],
  "changedFiles": [
    "android/app/build.gradle",
    "package.json"
  ],
  "reusableLesson": "For React Native DevTools 'No compatible apps connected', verify Hermes runtime, run debug build, reset Metro cache, and check device logs before changing native config."
}
```

Endpoint:

```http
GET /work-items/:id/lesson
```

Hermes can store this as memory.

## 11.4. Repo registry roadmap

Phase đầu có thể nhận `cwd` hoặc `repo.localPath`, nhưng Hermes không nên phải biết đường dẫn local dài hạn.

Roadmap model:

```ts
export interface RepoRegistryEntry {
  repoId: string;
  name: string;
  provider: "github" | "gitlab" | "local";
  owner?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  allowedWorkerLabels: string[];
  defaultLocalPaths: Record<string, string>;
}
```

Example:

```json
{
  "repoId": "cloudclass-v5",
  "name": "CloudclassV5",
  "provider": "gitlab",
  "remoteUrl": "git@gitlab.com:nghiant96/cloudclass-v5.git",
  "allowedWorkerLabels": ["macbook", "react-native", "ios", "android"],
  "defaultLocalPaths": {
    "nghia-macbook-worker": "/Users/trungnghianguyen/Documents/ISOFH/project-react-native-isofhcare-plus"
  }
}
```

Rule:

- Phase đầu: accept `cwd`/`repo.localPath` with strict root guards.
- Later: Hermes should submit `repoId`; Orchestra resolves worker-specific local path.
- Repo registry must not bypass worker workspace root validation.

---

## 12. Security model

## 12.1. Token model

Use different tokens:

```txt
AI_SYSTEM_SERVER_TOKEN     -> Dashboard/API clients
ORCHESTRA_WORKER_TOKEN     -> Worker registration/heartbeat/job
ORCHESTRA_HERMES_TOKEN     -> Hermes API/MCP access
```

Do not reuse one global token for all actors in production.

Execution backend is operational config, not an auth token:

```txt
ORCHESTRA_EXECUTION_BACKEND -> in-process|worker|hybrid
```

## 12.2. Actor model

```ts
export interface ActorRef {
  type: "user" | "hermes" | "worker" | "system" | "api";
  id: string;
  name?: string;
}
```

Every mutating API must write audit event:

```txt
create_work_item
execute_work_item
approve_step
cancel_work_item
assign_job
worker_started_job
artifact_uploaded
job_completed
delivery_started
pr_created
```

## 12.3. Policy gates

Require approval for:

- High-risk files:
  - auth
  - payment
  - secrets
  - infra
  - deployment
  - signing config
  - database migration
- Deleting files.
- Running destructive commands.
- Pushing branch.
- Creating PR.
- Modifying CI/CD.
- Modifying security rules.

## 12.4. Forbidden by default

Worker must reject:

```txt
rm -rf /
sudo commands unless explicitly allowed
reading ~/.ssh/*
reading .env files into prompt
printing secret values
modifying files outside workspace root
pushing directly to main/master
force push unless explicitly allowed
```

## 12.5. Secret redaction

Implement redaction before uploading logs:

Patterns:

```txt
sk-[A-Za-z0-9_\-]+
ghp_[A-Za-z0-9]+
glpat-[A-Za-z0-9_\-]+
-----BEGIN PRIVATE KEY-----
AWS_SECRET_ACCESS_KEY
GOOGLE_APPLICATION_CREDENTIALS
```

---

## 13. Dashboard changes

Add pages/panels:

## 13.1. Workers page

Show:

- worker name
- online/offline
- labels
- capabilities
- current job
- last heartbeat
- free disk
- CPU load

Actions:

- disable worker
- drain worker
- view logs

## 13.2. Work item detail improvements

Tabs:

```txt
Overview
Plan
Events
Artifacts
Evidence
Diff
Approvals
Worker
Lesson
```

## 13.3. Approval UI

Show:

- approval step
- reason
- risk level
- plan/diff summary
- affected files
- commands to run
- approve/reject buttons
- comment field

## 13.4. Artifact viewer

Support:

- text log
- diff
- JSON
- test output
- markdown summary

---

## 14. Implementation phases for Codex

## Phase 0 — Prep and service boundaries

Goal: prepare the existing server for worker mode without changing runtime behavior.

Tasks:

1. Extract service layer used by HTTP routes and future MCP tools:
   - work item service
   - job service
   - approval service
   - artifact service
2. Add `ORCHESTRA_EXECUTION_BACKEND` config parsing.
3. Add `ActorRef` compatibility wrapper around current audit actor model.
4. Add compatibility normalizer for work item input.
5. Add contract tests for existing `/jobs` and `/work-items` behavior before worker changes.

Acceptance criteria:

```txt
Existing `/jobs` and `/work-items` tests still pass
Route handlers delegate core behavior to service functions
ORCHESTRA_EXECUTION_BACKEND defaults to in-process
MCP can later call services without duplicating route logic
```

## Phase 1A — Worker registry foundation

Goal: API can register, heartbeat, and display workers without assigning real jobs yet.

Tasks:

1. Add `Worker` types.
2. Add worker store.
3. Add API:
   - `POST /workers/register`
   - `POST /workers/:workerId/heartbeat`
   - `POST /workers/:workerId/disable`
   - `POST /workers/:workerId/enable`
   - `POST /workers/:workerId/drain`
4. Add worker status transitions:
   - `online`
   - `idle`
   - `busy`
   - `draining`
   - `disabled`
   - `offline`
5. Add read-only dashboard display for workers.

Acceptance criteria:

```txt
pnpm test passes
pnpm typecheck passes
A worker can register and appear in API response
Heartbeat updates lastHeartbeatAt and health fields
Disable/enable/drain actions require operator permission and write audit events
Existing `/jobs` flow still works
```

## Phase 1B — Worker claim and lease

Goal: queued jobs can be claimed by exactly one eligible worker.

Tasks:

1. Add `POST /workers/:workerId/jobs/claim`.
2. Add claim eligibility policy:
   - backend mode allows worker execution
   - job status is `queued`
   - worker is online/idle and not disabled/draining
   - labels and capabilities match
   - repo path is inside worker workspace roots
   - attempt count is below limit
3. Add lease-based assignment:
   - `queued -> assigned`
   - assign `workerId`
   - create `leaseId`
   - set `lease.expiresAt`
   - reject stale or mismatched `leaseId` on complete/fail
4. Add idempotent `complete/fail` with valid `leaseId`.
5. Keep current in-process queue runner working through `ORCHESTRA_EXECUTION_BACKEND=in-process`.

Acceptance criteria:

```txt
A queued job can be claimed by exactly one matching worker
Duplicate claim attempts fail deterministically
Worker cannot claim a job outside workspace roots
Complete/fail requires valid leaseId
Existing `/jobs` in-process mode still works
```

## Phase 1C — Lease expiry, mutation checkpoints, and stall policy

Goal: worker failure and laptop sleep do not corrupt worktrees or run duplicate mutations.

Tasks:

1. Add heartbeat lease renewal.
2. Add stale lease detection.
3. Add mutation checkpoint tracking:
   - pre-mutation expired lease may requeue
   - post-mutation expired lease becomes `stalled`
4. Add manual recovery path for `stalled` jobs.
5. Add tests for heartbeat renewal, stale lease handling, mutation-aware stall, idempotent complete/fail, and duplicate claim prevention.

Acceptance criteria:

```txt
Expired leases are visible and recoverable
Pre-mutation expired jobs may be safely requeued
Post-mutation expired jobs do not auto-run on another worker
Stalled jobs require manual resume/cleanup policy
```

## Phase 1.5 — Security foundation

Goal: security guardrails exist before Local Worker executes provider commands on a user machine.

Tasks:

1. Add secret redaction helper.
2. Add command denylist and approval-required command policy.
3. Add path realpath guard and symlink escape tests.
4. Add token separation:
   - `AI_SYSTEM_SERVER_TOKEN`
   - `ORCHESTRA_WORKER_TOKEN`
   - `ORCHESTRA_HERMES_TOKEN`
5. Add minimal artifact/log scrubber before upload.

Acceptance criteria:

```txt
Secret-like values are redacted before log/artifact upload
Destructive commands are blocked or require approval
Symlink escape outside workspace roots is rejected
Worker token cannot call dashboard/operator-only APIs
Hermes token cannot call worker-only APIs
```

## Phase 2 — Local worker CLI

Goal: local machine can run worker loop.

Tasks:

1. Add CLI command `ai worker start`.
2. Implement env config:
   - `ORCHESTRA_SERVER_URL`
   - `ORCHESTRA_WORKER_TOKEN`
   - `ORCHESTRA_WORKER_NAME`
   - `ORCHESTRA_WORKER_LABELS`
   - `ORCHESTRA_WORKSPACE_ROOTS`
3. Implement register/heartbeat/claim loop.
4. Implement basic job executor for existing `/jobs` payload.
5. Upload logs back to server.
6. Complete/fail with `leaseId`.
7. Send mutation checkpoints before apply/delivery stages.
8. Graceful shutdown.

Acceptance criteria:

```txt
pnpm ai worker start registers worker
worker heartbeats every 10s
worker can claim a dummy job
worker uploads redacted logs
worker completes/fails with valid lease
worker marks filesystem mutation before applying patch
```

## Phase 3 — Work item API normalization

Goal: normalize first-class `/work-items`, then optionally expose `/api/work-items` as aliases.

Tasks:

1. Normalize existing `/work-items` API before adding `/api/work-items` aliases.
2. Add optional fields:
   - `executionMode`
   - `workflowProfile`
   - `routingProfile`
   - `requestedBy`
   - `stage`
3. Keep old fields and statuses backward-compatible.
4. Link work item to existing job system and worker lease assignments.
5. Add work item event stream.
6. Persist work item status transitions.
7. Add audit events.

Acceptance criteria:

```txt
POST /work-items creates durable item
POST /work-items/:id/run enqueues job
GET /work-items/:id/events streams status/logs
Audit log records create/execute/approve/cancel
Existing dashboard work item list/detail continues to render
```

## Phase 4 — Superpowers workflow profile

Goal: add methodology layer.

Tasks:

1. Add workflow profile registry.
2. Add `superpowers` profile.
3. Keep existing `WorkflowMode` as `executionMode`.
4. Add prompt injection block for planner/generator/reviewer when `workflowProfile=superpowers`.
5. Add evidence checklist.
6. Add plan approval gate for `superpowers`.
7. Add final delivery approval gate.
8. Bind approvals to immutable artifact ids and hashes.

Acceptance criteria:

```txt
workItem.workflowProfile = superpowers requires plan artifact
job pauses for plan approval
evidence checklist is generated
final delivery requires approval
approval becomes stale if referenced artifact changes
```

## Phase 5 — MCP wrapper

Goal: Hermes can call Orchestra through MCP.

Tasks:

1. Add MCP server entrypoint.
2. Implement tools:
   - `orchestra_create_work_item`
   - `orchestra_run_work_item`
   - `orchestra_get_work_item`
   - `orchestra_get_artifacts`
   - `orchestra_approve_step`
   - `orchestra_cancel_work_item`
3. MCP tools call internal API/service layer, not duplicate logic.
4. Add token/actor identity.
5. Require `approvedBy`, `approvalSource`, `userConfirmationId`, and artifact hashes for approval tools.

Acceptance criteria:

```txt
MCP client can create work item
MCP client can run work item
MCP client can fetch status
MCP client can approve pending step
All actions are audited as actor=hermes
Approval actions record both Hermes actor and user approver
```

## Phase 6 — Hermes lesson loop

Goal: export reusable lesson after each job.

Tasks:

1. Add `GET /work-items/:id/lesson`.
2. Generate lesson from:
   - task
   - plan
   - failed checks
   - successful repairs
   - final diff
   - commands passed
3. Add artifact `summary` and `lesson`.
4. Add MCP tool `orchestra_get_lesson`.

Acceptance criteria:

```txt
Completed work item has lesson JSON
Failed work item has failure lesson JSON
Hermes can retrieve lesson through MCP/API
```

---

## 15. Suggested file structure

Add/modify:

```txt
ai-system/
  worker/
    worker-client.ts
    worker-loop.ts
    worker-runtime.ts
    worker-config.ts
    worker-safety.ts
    job-executor.ts

  workers/
    worker-store.ts
    worker-types.ts
    worker-routes.ts
    worker-service.ts

  work/
    work-item.ts
    work-store.ts
    work-routes.ts
    work-service.ts
    work-events.ts
    lesson-exporter.ts

  workflows/
    workflow-profile.ts
    workflow-registry.ts
    profiles/
      default.ts
      fast-fix.ts
      balanced.ts
      superpowers.ts
      strict-review.ts

  mcp/
    server.ts
    auth.ts
    tools/
      create-work-item.ts
      run-work-item.ts
      get-work-item.ts
      get-artifacts.ts
      approve-step.ts
      cancel-work-item.ts
      get-lesson.ts

  security/
    path-policy.ts
    secret-redaction.ts
    risk-policy.ts
    command-policy.ts

dashboard/
  src/
    pages/
      WorkersPage.tsx
      WorkItemDetailPage.tsx
    components/
      WorkerStatusCard.tsx
      ApprovalPanel.tsx
      ArtifactViewer.tsx
      EvidenceChecklist.tsx
```

---

## 16. Test plan

## 16.1. Unit tests

```txt
worker-store.test.ts
worker-safety.test.ts
secret-redaction.test.ts
workflow-profile.test.ts
risk-policy.test.ts
mcp-tools.test.ts
lesson-exporter.test.ts
```

## 16.2. Integration tests

```txt
worker-register-and-claim.test.ts
work-item-execute-flow.test.ts
approval-gate.test.ts
superpowers-workflow.test.ts
artifact-upload.test.ts
```

## 16.2.1. Contract tests

Worker/server contract tests are required before real worker execution:

```txt
worker-claim-contract.test.ts
worker-lease-contract.test.ts
worker-complete-fail-contract.test.ts
approval-artifact-contract.test.ts
work-item-normalizer-contract.test.ts
execution-backend-contract.test.ts
```

Contract test scenarios:

```txt
two workers claim the same queued job -> exactly one succeeds
worker completes with stale leaseId -> rejected
same worker repeats complete with same leaseId/result -> idempotent success
post-mutation lease expires -> job becomes stalled
approval references old artifact hash -> approval rejected/stale
legacy work item payload and new payload normalize to same internal shape
execution backend in-process does not expose jobs to external worker claims
```

## 16.3. Manual E2E test

```bash
# Terminal 1
pnpm run server

# Terminal 2
pnpm ai worker start \
  --server http://localhost:3000 \
  --name local-test-worker \
  --labels local,test \
  --workspace-root "$PWD"

# Terminal 3
curl -X POST http://localhost:3000/work-items \
  -H "Authorization: Bearer $AI_SYSTEM_SERVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Update README test",
    "description":"Add a short test section to README in dry-run mode",
    "repo":{"provider":"local","name":"Orchestra-AI-Platform","localPath":"'$PWD'"},
    "executionMode":"fix",
    "workflowProfile":"superpowers",
    "routingProfile":"balanced"
  }'
```

Expected:

```txt
work item created
job queued
worker picks job
plan artifact created
approval required
after approval, job continues
diff artifact created
evidence checklist updated
```

---

## 17. Risks and mitigations

## 17.1. Hermes and Orchestra both trying to control execution

Mitigation:

```txt
Hermes can request and approve.
Orchestra controls execution.
Worker controls local runtime.
```

## 17.2. Worker runs unsafe commands

Mitigation:

- command policy
- path policy
- approval gates
- dry-run default
- audit log

## 17.3. Secrets leak into prompts/logs

Mitigation:

- redaction
- deny reading secret files
- prompt context filter
- artifact scrubber

## 17.4. CLI provider output format changes

Mitigation:

- provider adapter abstraction
- robust parsing
- fallback text mode
- artifact raw transcript
- tests per provider adapter

## 17.5. Long-running jobs fail after laptop sleep

Mitigation:

- heartbeat timeout
- job lease
- resumable checkpoints
- mark job as `stalled`
- allow reassignment if safe

---

## 18. Configuration examples

## 18.1. Server `.env`

```env
AI_SYSTEM_SERVER_TOKEN=change-me
ORCHESTRA_HERMES_TOKEN=change-me-hermes
ORCHESTRA_WORKER_TOKEN=change-me-worker
ORCHESTRA_EXECUTION_BACKEND=worker
AI_SYSTEM_MEMORY=local-file
AI_SYSTEM_SANDBOX=inherit
ORCHESTRA_QUEUE_BACKEND=local
ORCHESTRA_ARTIFACT_STORE=file
```

## 18.2. Worker `.env`

```env
ORCHESTRA_SERVER_URL=http://your-server:3000
ORCHESTRA_WORKER_TOKEN=change-me-worker
ORCHESTRA_WORKER_NAME=nghia-macbook-worker
ORCHESTRA_WORKER_LABELS=macbook,react-native,ios,android
ORCHESTRA_WORKSPACE_ROOTS=/Users/trungnghianguyen/Documents,/Users/trungnghianguyen/FootballApp
```

## 18.3. Hermes config concept

```json
{
  "tools": {
    "orchestra": {
      "type": "mcp",
      "command": "node",
      "args": ["./dist/ai-system/mcp/server.js"],
      "env": {
        "ORCHESTRA_SERVER_URL": "http://your-server:3000",
        "ORCHESTRA_HERMES_TOKEN": "change-me-hermes"
      }
    }
  }
}
```

---

## 19. Definition of Done

Kiến trúc mới được coi là xong bản đầu khi:

```txt
1. Hermes hoặc MCP client tạo được work item.
2. Orchestra API lưu work item và enqueue job.
3. Local worker register và claim job bằng lease.
4. Server ngăn duplicate claim và reclaim được expired lease.
5. Worker chạy được một dry-run task trong repo local.
6. Worker upload plan/log/diff artifacts.
7. Superpowers workflow tạo approval gate.
8. User approve qua API.
9. Worker hoàn thành job bằng valid leaseId và cập nhật status.
10. Dashboard hiển thị worker, work item, events, artifacts.
11. Existing `/jobs` và `/work-items` dashboard/CLI flow vẫn hoạt động.
12. Audit log đầy đủ.
13. Lesson JSON export được cho Hermes.
```

---

## 20. Codex implementation instruction

Khi Codex triển khai tài liệu này, làm theo thứ tự:

```txt
1. Đọc README hiện tại, docs/SERVER.md, docs/WORKSPACE.md, ai-system/server.ts, ai-system/server-app.ts.
2. Không phá vỡ API /jobs hiện có.
3. Không phá vỡ API /work-items hiện có.
4. Không rename WorkItemStatus hoặc WorkflowMode nếu chưa có migration.
5. Làm Phase 0 trước: service layer, execution backend config, ActorRef compatibility, normalizer.
6. Làm Phase 1A worker registry trước, chưa claim job.
7. Làm Phase 1B claim/lease sau khi registry ổn định.
8. Làm Phase 1C mutation checkpoint/stalled policy trước khi chạy worker thật.
9. Làm Phase 1.5 security trước Local Worker CLI.
10. Thêm Local Worker CLI sau khi security guardrails có test.
11. Sau khi worker claim/heartbeat/complete dummy job ổn định, mới mở rộng work item API.
12. Sau khi work item flow chạy được, mới thêm Superpowers workflowProfile.
13. Sau khi workflow chạy được, mới thêm MCP wrapper.
14. Mọi bước phải có test.
15. Giữ dry-run default.
16. Không hard-code đường dẫn máy của user vào source; chỉ dùng env/config hoặc repo registry.
```

---

## 21. Commands Codex nên chạy để verify

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm run dashboard:build
```

Nếu thêm server/worker integration test:

```bash
pnpm test -- server
pnpm test -- worker
pnpm test -- work
```

---

## 22. Tóm tắt một câu

```txt
Server quản lý việc. Local Worker làm việc. Hermes giao việc. Orchestra kiểm soát việc. Superpowers định nghĩa cách làm. Codex/Claude/Antigravity sửa code.
```
