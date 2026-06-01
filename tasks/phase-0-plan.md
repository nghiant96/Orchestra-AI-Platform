# Phase 0 — Prep And Service Boundaries

## Mục tiêu

Tách logic nghiệp vụ khỏi route handlers để HTTP routes, future MCP tools, và worker APIs có thể reuse cùng behavior. Không thay đổi runtime behavior hiện tại.

## Codebase đã đọc

| File | Purpose |
|---|---|
| `ai-system/server-app.ts` | Main server setup, route registration, runner, queue, broadcast |
| `ai-system/server/routes/jobs.ts` | `/run`, `/jobs` (CRUD, approve, cancel, file content) |
| `ai-system/server/routes/work-items.ts` | `/work-items` (CRUD, assess, run, handoff, cancel/retry) |
| `ai-system/server/routes-context.ts` | `ServerRouteContext` interface và `RouteHandler` type |
| `ai-system/core/job-queue.ts` | `FileBackedJobQueue`, `QueueJob`, `JobRunner`, `JobQueueRunInput` types |
| `ai-system/core/audit-log.ts` | `FileAuditLog`, `AuditActor`, `AuditEvent`, `parseAuditActor` |
| `ai-system/core/permissions.ts` | `canPerformAction`, `resolveProjectRole` |
| `ai-system/core/normalizers.ts` | `normalizeQueueJob`, `normalizeAuditEvent`, `normalizePersistedRunState` |
| `ai-system/core/workflow-modes.ts` | `WorkflowMode` type và `applyWorkflowModeDefaults` |
| `ai-system/types.ts` | Shared types: `Logger`, `OrchestratorResult`, `ConfirmationHandler`, etc. |
| `ai-system/work/work-item.ts` | `WorkItem`, `WorkItemStatus`, `WorkItemType`, `ExecutionGraph`, etc. |
| `ai-system/work/work-store.ts` | `WorkStore` — file-backed persistence cho work items |
| `ai-system/work/work-engine.ts` | `WorkEngine` — assessment, execution plan, run reconciliation, handoff |
| `ai-system/work/normalizers.ts` | `normalizeWorkItem` |
| `tests/test-utils.ts` | Test helpers: `listen`, `closeServer`, `silentLogger`, `requestJson` |
| `tests/server-queue.test.ts` | API tests for `/jobs`, `/run`, cancel, approve |
| `tests/work-item-store.test.ts` | Store tests for WorkItem CRUD |
| `tests/work-engine.test.ts` | Engine tests for execution plan and reconciliation |
| `docs/SERVER.md` | API docs cho tất cả endpoints |
| `docs/WORKSPACE.md` | Domain glossary cho Workspace/WI/Run architecture |

---

## Step-by-step

### Step 1: `ORCHESTRA_EXECUTION_BACKEND` config

File: `ai-system/core/execution-backend.ts` (NEW)

```typescript
export type ExecutionBackend = "in-process" | "worker" | "hybrid";

export function resolveExecutionBackend(): ExecutionBackend {
  const value = (process.env.ORCHESTRA_EXECUTION_BACKEND || "in-process").toLowerCase();
  if (value === "worker" || value === "hybrid" || value === "in-process") return value;
  return "in-process";
}
```

- Expose trong `/health` để inspect được.

### Step 2: Extract `job-service.ts`

File: `ai-system/jobs/job-service.ts` (NEW)

Extract từ `ai-system/server/routes/jobs.ts`:

Service functions:
- `createSyncRun()` — từ `POST /run`
- `createJob()` — từ `POST /jobs`
- `listJobs()` — từ `GET /jobs`
- `getJob()` — từ `GET /jobs/:id`
- `cancelJob()` — từ `POST /jobs/:id/cancel`
- `approveJob()` — từ `POST /jobs/:id/(approve|reject)`
- `getJobFileContent()` — từ `GET /jobs/:id/files/content`
- `loadRules()` — keep as helper
- `parseWorkflowMode()` — keep as helper
- `isPathWithinRoot()` — keep as helper

Context type: `JobServiceContext` 
```typescript
export interface JobServiceContext {
  queue: FileBackedJobQueue;
  auditLog: FileAuditLog;
  actor: AuditActor;
  rules: RulesConfig;
}
```

### Step 3: Extract `work-item-service.ts`

File: `ai-system/work/work-item-service.ts` (NEW)

Service functions:
- `listWorkItems()`
- `createWorkItem()`
- `getWorkItem()`
- `assessWorkItem()`
- `runWorkItem()`
- `handoffWorkItem()`
- `cancelOrRetryWorkItem()`

Context type: `WorkItemServiceContext`
```typescript
export interface WorkItemServiceContext {
  actor: AuditActor;
  auditLog: FileAuditLog;
  rules: RulesConfig;
  queue: FileBackedJobQueue;
}
```

### Step 4: `normalizeWorkItemInput()`

Thêm vào `ai-system/work/work-item-service.ts`:
- Parse old payload (title, description, type, source, expectedOutput, linkedRuns)
- Parse new Hermes optional fields (stage, executionMode, workflowProfile, routingProfile, requestedBy, repo)
- Backward compatible hoàn toàn

### Step 5: Route handlers delegate to services

File `ai-system/server/routes/jobs.ts`: replace inline logic with service calls
File `ai-system/server/routes/work-items.ts`: replace inline logic with service calls

HTTP concerns stay in route: parse body, parse URL, cwd resolve, auth check, respondJson.

### Step 6: `ActorRef` compatibility wrapper

Thêm `ActorRef` interface vào `ai-system/server/routes-context.ts`:
```typescript
export interface ActorRef {
  id: string;
  role: AuditRole;
  isAuthorized(action: string, rules: RulesConfig, projectId?: string): boolean;
}
```

### Step 7: Health endpoint shows `executionBackend`

Thêm field vào response của `/health`.

### Step 8: Regression tests

- `tests/job-service.test.ts`: test all service functions
- `tests/work-item-service.test.ts`: test all service functions + normalizeWorkItemInput

---

## Verification

```bash
pnpm typecheck
pnpm test -- server-queue
pnpm test -- work-item-store
pnpm test -- work-engine
pnpm test -- job-service
pnpm test -- work-item-service
pnpm run dashboard:build
```

---

## Acceptance criteria

- [ ] Existing `/jobs` API tests pass
- [ ] Existing `/work-items` API tests pass
- [ ] `ORCHESTRA_EXECUTION_BACKEND` xuất hiện trong `/health` response
- [ ] Route handlers delegate core behavior to service functions
- [ ] No dashboard or CLI behavior changes
- [ ] `normalizeWorkItemInput()` accepts old payloads
- [ ] `normalizeWorkItemInput()` accepts new Hermes optional fields without breaking
