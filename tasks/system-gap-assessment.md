# System Gap Assessment: Current State vs Upgrade Plan

**Ngày đánh giá:** 28/04/2026  
**Phạm vi:** So sánh mã nguồn hiện tại với `tasks/system-upgrade-plan.md`

---

## Tổng quan

| Theme | Tên | Tiến độ | Nhận xét |
|-------|-----|---------|----------|
| A | Dashboard V4 - Production Control Center | 🟡 ~25% | Có sẵn job list, detail modal, approval, analytics nhưng thiếu code splitting, filter nâng cao, budget panel, run comparison |
| B | Queue & Multi-Project Orchestration | 🟡 ~20% | Queue cơ bản hoạt động, thiếu concurrency per workspace, heartbeat, retention, cancel propagation, project registry |
| C | Cross-Language Execution V2 | 🔴 ~0% | Chưa có adapter V2 nào cho ruff/mypy/golangci-lint/cargo clippy |
| D | Observability, Cost Governance & Reporting | 🟡 ~15% | Cost tracking per-run đã có, thiếu governance cấp workspace, alerts, trend charts, JSON export |
| E | Error Classification & Recovery | 🟡 ~20% | `FailureClass` enum cơ bản có, thiếu error taxonomy đầy đủ, retry policy theo class, artifact validation |
| F | Plugin & Tool Extensibility | 🔴 ~0% | Không tìm thấy bất kỳ code nào liên quan đến plugin system |

---

## Theme A: Dashboard V4 - Production Control Center

### Đã có ✅

| Deliverable | Status | Bằng chứng |
|------------|--------|-----------|
| Jobs board với queue states | ✅ Có | `App.tsx` có `JobItem` list, status filter `all/running/completed/failed` |
| Detail panel cho execution stages | ✅ Có | `JobDetailModal.tsx` có timeline tab hiển thị transitions |
| Approval UI | ✅ Có | Approval bar với Approve/Reject khi `waiting_for_approval` |
| Empty/error states | ✅ Một phần | Có empty state cho job list (SearchCode icon + message), missing metric data |

### Chưa có / Cần cải thiện 🔴

| Deliverable | Status | Chi tiết thiếu |
|------------|--------|---------------|
| Code splitting (route-level/dynamic imports) | 🔴 Chưa có | **Build cảnh báo chunk 785KB > 500KB limit.** Không có `React.lazy()` hay `dynamic import` nào trong codebase dashboard. Tất cả components load đồng bộ |
| Status filters đầy đủ | 🟡 Thiếu | Hiện chỉ có `all/running/completed/failed`. Plan yêu cầu thêm: `queued`, `waiting_for_approval`, `cancel_requested`, `cancelled` |
| Filter theo provider, workspace, date range, cost range | 🔴 Chưa có | Chỉ có search text + status filter |
| Transition timeline với retry target & artifact links | 🟡 Một phần | Timeline có nhưng không show retry target hay link đến artifact cụ thể |
| Approval UI có diff/context preview | 🟡 Một phần | Approval bar đơn giản, không show plan diff/context preview trước khi approve |
| Budget panel (max duration, max cost, estimated cost, exceeded reason) | 🔴 Chưa có | Analytics tab show cost tổng nhưng không có dedicated budget panel so sánh actual vs limit |
| Run comparison view (latest vs previous) | 🔴 Chưa có | Không có cơ chế compare 2 runs |
| Loading state chuẩn | 🟡 Một phần | Có loading indicator trên Navbar nhưng không có skeleton/shimmer khi load job list |

### Verification status

| Check | Status | Kết quả |
|-------|--------|---------|
| `pnpm run dashboard:build` pass | ⚠️ Pass nhưng có warning | Build thành công nhưng chunk **785.55 KB** vượt 500KB limit |
| `pnpm run typecheck` | ✅ | Đã xanh |
| `pnpm run lint` | ✅ | Đã xanh |

---

## Theme B: Queue & Multi-Project Orchestration

### Đã có ✅

| Deliverable | Status | Bằng chứng |
|------------|--------|-----------|
| Queue scheduler cơ bản | ✅ Có | `job-queue.ts` `FileBackedJobQueue` với `drain()` loop |
| Concurrency per server | ✅ Có | `concurrency` option trong constructor, sử dụng trong `drain()` |
| Cancel basic (queued → cancelled, running → cancel_requested) | ✅ Có | Hàm `cancel()` |
| Workspace allowlist validation | ✅ Có | `normalizeAllowedWorkdirs()` và `resolveRequestedCwd()` trong `server-app.ts` |
| Queue states: queued, running, waiting_for_approval, completed, failed, cancel_requested, cancelled | ✅ Có | Type `QueueJobStatus` đầy đủ 7 states |

### Chưa có / Cần cải thiện 🔴

| Deliverable | Status | Chi tiết thiếu |
|------------|--------|---------------|
| Concurrency per workspace | 🔴 Chưa có | Chỉ có global concurrency, không track per-workspace |
| Workspace allowlist nhất quán cho create/list/get job | 🟡 Một phần | Validation chỉ ở `POST /jobs` và `POST /run`, `GET /jobs` không filter theo workspace |
| Job lease/heartbeat (detect crashed jobs) | 🔴 Chưa có | Không có heartbeat mechanism. Nếu server crash khi job đang `running`, job sẽ stuck ở trạng thái đó mãi |
| Retry policy theo failure class | 🔴 Chưa có | Không có auto-retry logic cho failed jobs |
| Cancel propagation vào execution state machine & subprocess | 🔴 Chưa có | Cancel chỉ set status trong queue JSON. Không có signal propagation vào `Orchestrator.run()` hay subprocess đang chạy |
| Job retention policy (keep last N / keep N days) | 🔴 Chưa có | Jobs tích lũy vĩnh viễn trong `.ai-system-server/jobs/` |
| Project registry local | 🔴 Chưa có | Dashboard không list được các workspace đã config. Chỉ dùng `defaultCwd` |
| Server health detail (active jobs, queued jobs, queue config, storage path) | 🟡 Thiếu | `/health` chỉ return `{ ok, mode, cwd, queue: { enabled, concurrency } }`. Không có active/queued job count, storage path, allowed workdirs |

---

## Theme C: Cross-Language Execution V2

### Đã có ✅

| Feature | Status | Bằng chứng |
|---------|--------|-----------|
| Tool adapter framework | ✅ Có | `ToolAdapterConfig` type, `detectToolAdapterContexts()`, `resolveAdapterToolCommand()` trong `tool-executor.ts` |
| Sandbox image profiles (node, python, go, rust) | ✅ Có | `ToolSandboxImageProfile` type cho auto/node/python/go/rust |
| Baseline adapter config structure | ✅ Có | Config schema hỗ trợ `adapters` trong `ToolExecutionConfig` |

### Chưa có / Cần cải thiện 🔴

| Deliverable | Status | Chi tiết thiếu |
|------------|--------|---------------|
| Python adapter V2 (ruff, mypy, pytest, uv, poetry, pipenv) | 🔴 Chưa có | Không tìm thấy bất kỳ reference nào đến `ruff`, `mypy` trong codebase |
| Go adapter V2 (go test, go vet, golangci-lint) | 🔴 Chưa có | Không có auto-detect cho Go tools |
| Rust adapter V2 (cargo test, cargo clippy, workspace members) | 🔴 Chưa có | Không có auto-detect cho Rust tools |
| Changed-file scoping rules cho Python/Go/Rust | 🔴 Chưa có | Adapter chỉ filter theo `changedFileExtensions` generic |
| Docker image profile docs & default commands | 🔴 Chưa có | Không có documentation cho image profiles |
| Artifact summary hiển thị detected language adapter | 🔴 Chưa có | Artifact index không chứa adapter detection info |
| Parser confidence signal cho context ranking | 🔴 Chưa có | Tree-sitter fallback có nhưng không có confidence score |

---

## Theme D: Observability, Cost Governance & Reporting

### Đã có ✅

| Feature | Status | Bằng chứng |
|---------|--------|-----------|
| Cost/token tracking per stage | ✅ Có | `ProviderUsageMetric`, `ExecutionProviderMetric` types, `buildProviderMetrics()` trong `execution-summary.ts` |
| Budget exceeded detection | ✅ Có | `buildExecutionBudgetSummary()` check duration & cost |
| Dashboard cost per run | ✅ Có | Analytics tab trong JobDetailModal có cost distribution chart |
| CLI `--json` & `--save` output | ✅ Có | arg-parser hỗ trợ `--json` và `--save` |
| `ai runs latest/show` | ✅ Có | CLI commands đã có |

### Chưa có / Cần cải thiện 🔴

| Deliverable | Status | Chi tiết thiếu |
|------------|--------|---------------|
| Persist normalized provider usage events per stage vào artifacts | 🟡 Một phần | `providerMetrics` lưu trong execution summary nhưng không persist per-stage detail (input/output tokens) |
| Cost report trong `ai runs latest/show` (input/output tokens, model) | 🟡 Thiếu | `runs show` hiển thị tổng nhưng không breakdown tokens per provider/model |
| Dashboard charts: cost over time, failures by class, average duration by stage | 🔴 Chưa có | Chỉ có cost distribution per role cho 1 run. Không có time-series charts cross-run |
| Budget warning trước generation (estimated context size) | 🔴 Chưa có | Budget check chỉ xảy ra sau khi run xong |
| Config cấp workspace: max daily cost, max single-run cost | 🔴 Chưa có | `ExecutionBudgetConfig` chỉ có `max_duration_ms` và `max_cost_units` per-run. Không có daily aggregate |
| Adaptive routing signal dựa trên cost efficiency | 🔴 Chưa có | Router có adaptive scoring nhưng không dùng cost efficiency signal |
| JSON export cho run analytics | 🟡 Một phần | `--json` export toàn bộ run result nhưng không có analytics summary riêng |

---

## Theme E: Error Classification & Recovery Hardening

### Đã có ✅

| Feature | Status | Bằng chứng |
|---------|--------|-----------|
| FailureClass enum | ✅ Có | 8 classes: paused, cancelled, tool-check-failed, validation-failed, duration-budget-exceeded, cost-budget-exceeded, iteration-limit, review-blocking-issues, unknown |
| `classifyRunFailure()` | ✅ Có | `execution-summary.ts` logic phân loại |
| RetryHint type | ✅ Có | `RetryHint { stage, iteration?, reason }` |
| Resume từ checkpoint | ✅ Có | `orchestrator.resume.test.ts` 21KB tests |

### Chưa có / Cần cải thiện 🔴

| Deliverable | Status | Chi tiết thiếu |
|------------|--------|---------------|
| Error taxonomy đầy đủ: ProviderTimeout, ProviderResponse, ContextOverflow, ArtifactCorrupt, ApprovalRejected | 🔴 Chưa có | Hiện `FailureClass` chỉ có 8 class cơ bản. Không phân biệt provider timeout vs response error |
| Chuẩn hoá failure class trong server job result | 🟡 Một phần | Job result có `error` string nhưng không có structured failure class |
| Retryability rules theo error class | 🔴 Chưa có | Không có mapping `FailureClass → isRetryable` hay auto-retry decision |
| Resume hints rõ ràng cho từng failure class | 🟡 Một phần | `RetryHint` type có nhưng không phải mọi failure class đều generate hint |
| Artifact validation trước resume/apply | 🔴 Chưa có | Không có integrity check trước khi load artifact cho resume |
| Dashboard failure panel (root cause, retry target, suggested action) | 🔴 Chưa có | Diagnostics tab chỉ show tool results, không show structured failure analysis |
| Tests cho corrupted artifact, cancelled job, rejected approval, tool timeout | 🟡 Một phần | Có tests cho resume/cancel nhưng không test corrupted artifact hay tool timeout scenarios |

---

## Theme F: Plugin & Tool Extensibility

### Đã có ✅

| Feature | Status | Bằng chứng |
|---------|--------|-----------|
| Prompt override system | ✅ Có | `PromptOverrideConfig` cho custom templates |
| Tool adapter config | ✅ Có | Config-driven adapter registration qua `.ai-system.json` |

### Chưa có / Cần cải thiện 🔴

| Deliverable | Status | Chi tiết thiếu |
|------------|--------|---------------|
| Plugin manifest schema | 🔴 Chưa có | Không có plugin concept nào trong codebase |
| Plugin discovery từ `.ai-system/plugins` | 🔴 Chưa có | |
| Plugin đăng ký tool adapter, validation, prompt templates | 🔴 Chưa có | |
| `ai plugins list` / `ai plugins doctor` | 🔴 Chưa có | |
| Sandbox/path safety validation cho plugin commands | 🔴 Chưa có | |
| Example plugin | 🔴 Chưa có | |
| Plugin lifecycle & security docs | 🔴 Chưa có | |

---

## Immediate Action Items (ưu tiên theo Milestone 1)

### 🔥 Critical (nên làm trước)

- [ ] **Dashboard code splitting** — Chunk 785KB cần tách ngay. Dùng `React.lazy()` cho `JobDetailModal`, `ConfigView`, `FileDiffView`, Recharts.
- [ ] **Health endpoint chi tiết** — `/health` thiếu active/queued job count, allowed workdirs, storage path.
- [ ] **Cancel propagation** — Cancel hiện chỉ set status, không stop execution/subprocess thực tế.
- [ ] **Job heartbeat/lease** — Crashed jobs stuck ở `running` forever. Cần timeout mechanism.

### ⚡ High Priority (Milestone 1 scope)

- [ ] **Dashboard status filters đầy đủ** — Thêm `queued`, `waiting_for_approval`, `cancelled` vào filter bar.
- [ ] **Budget panel trên dashboard** — Hiện cost info nằm rải rác, cần dedicated panel.
- [ ] **Error taxonomy mở rộng** — Thêm `ProviderTimeout`, `ProviderResponse`, `ArtifactCorrupt` vào `FailureClass`.
- [ ] **Failure panel trên dashboard** — Diagnostics tab cần show structured root cause + suggested action.

### 📋 Medium Priority (Milestone 2 scope)

- [ ] **Job retention policy** — Tránh tích lũy file vô hạn.
- [ ] **Cross-language adapters V2** — Bắt đầu với Python (ruff + mypy) vì phổ biến nhất.
- [ ] **Cost governance** — `max_daily_cost` config + pre-generation budget warning.
- [ ] **Dashboard cross-run analytics** — Cost over time, failure trends.

---

## Kết luận

Hệ thống đã có **nền tảng tốt** từ giai đoạn V3: execution state machine, artifact system, queue cơ bản, provider routing, và dashboard với approval workflow. Tuy nhiên, **khoảng cách lớn nhất** nằm ở:

1. **Dashboard bundle size & missing features** (Theme A) — chunk 785KB, thiếu code splitting, thiếu nhiều filter/panel
2. **Queue robustness** (Theme B) — cancel propagation, heartbeat, retention đều chưa có
3. **Cross-language** (Theme C) — hoàn toàn chưa triển khai V2
4. **Plugin system** (Theme F) — chưa bắt đầu

Khuyến nghị: bắt đầu với **Dashboard code splitting + Queue hardening** (items 1-4 Critical) vì chúng ảnh hưởng trực tiếp đến khả năng vận hành production hàng ngày.
