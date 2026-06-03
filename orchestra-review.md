# Orchestra AI Platform — Code Review Chi Tiết

> **Mục đích:** Review toàn diện để Codex xử lý từng phần độc lập.
> **Nguồn:** https://github.com/nghiant96/Orchestra-AI-Platform
> **Ngày review:** 2026-06-02

---

## Mục lục

1. [Tổng quan & Đánh giá nhanh](#1-tổng-quan--đánh-giá-nhanh)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [State Machine & Pipeline](#3-state-machine--pipeline)
4. [Context Intelligence](#4-context-intelligence)
5. [Agent Design](#5-agent-design)
6. [Server & API Layer](#6-server--api-layer)
7. [Security Model](#7-security-model)
8. [Worker & Distributed Execution](#8-worker--distributed-execution)
9. [Dashboard & Observability](#9-dashboard--observability)
10. [Developer Experience & Onboarding](#10-developer-experience--onboarding)
11. [Testing & CI/CD](#11-testing--cicd)
12. [Workspace Domain Model](#12-workspace-domain-model)
13. [Danh sách việc cần làm cho Codex](#13-danh-sách-việc-cần-làm-cho-codex)

---

## 1. Tổng quan & Đánh giá nhanh

### Mô tả dự án

Orchestra là một **local-first control plane** cho AI coding agents. Nó biến các CLI (Codex, Gemini, Claude) thành một workflow lập trình có tổ chức với lập kế hoạch, kiểm tra tự động, vòng lặp tự sửa lỗi, và phê duyệt từ con người.

### Scorecard tổng thể

| Tiêu chí                  | Điểm | Ghi chú                                          |
| ------------------------- | ---- | ------------------------------------------------ |
| Ý tưởng / Vision          | 5/5  | Giải quyết bài toán thực tế, thị trường rõ ràng |
| Kiến trúc tổng thể        | 4/5  | Rõ ràng, có tư duy domain-driven                |
| State machine design      | 4/5  | Solid, nhưng error handling chưa documented      |
| Context intelligence      | 5/5  | Điểm khác biệt lớn nhất của dự án               |
| Security model            | 3/5  | Tốt cho local, rủi ro nếu exposed               |
| Worker / distributed      | 2/5  | Còn rất sơ khai                                 |
| Developer experience      | 2/5  | Onboarding phức tạp                             |
| Testing / CI              | 1/5  | Thiếu hoàn toàn CI, test coverage chưa rõ       |
| Documentation vs reality  | 3/5  | Một số phần mô tả tương lai, không phải hiện tại |

### Kết luận nhanh

Dự án có nền tảng kỹ thuật tốt và tư duy hệ thống rõ ràng. Vấn đề chính là **gap giữa tài liệu và implementation**, thiếu CI/CD, và onboarding phức tạp. Các mục bên dưới đi sâu từng phần với task cụ thể cho Codex.

---

## 2. Kiến trúc hệ thống

### Mô tả hiện tại

```
Input (CLI / HTTP / Dashboard)
    ↓
Orchestrator (State Machine)
    ↓
Routing Layer (Provider Selection)
    ↓
Agent Layer (Planner → Generator → Reviewer → Fixer)
    ↓
Context Intelligence (Dep Graph + Vector Index)
    ↓
Tool Executor (inherit / clean-env / docker)
    ↓
Artifact Store (.ai-system-artifacts/)
```

### Vấn đề phát hiện

**P1 — Không có circuit breaker giữa các layer.**
Khi Routing Layer không resolve được provider (CLI không cài, timeout), pipeline tiếp tục hay dừng? Behavior chưa được document và có thể chưa được implement.

**P2 — Phụ thuộc nặng vào external CLIs.**
Toàn bộ giá trị của hệ thống phụ thuộc vào các binary bên ngoài (`gemini`, `codex`, `claude`). Không có abstraction layer kiểm tra version compatibility hay fallback khi CLI thay đổi breaking API.

**P3 — Single-process bottleneck.**
Mode `in-process` chạy tất cả agents trong một process. Nếu một agent bị OOM hoặc hang, toàn bộ pipeline bị ảnh hưởng.

### Tasks cho Codex

```
TASK-ARCH-01: Thêm provider health-check khi khởi động
- Kiểm tra từng CLI trong config có accessible không
- Warn rõ ràng nếu thiếu, fail fast thay vì fail ở giữa pipeline
- File liên quan: ai-system/providers/ hoặc tương đương

TASK-ARCH-02: Thêm CLI version compatibility matrix
- Define supported version ranges cho mỗi CLI provider
- Check version khi register provider
- Warn nếu version không khớp

TASK-ARCH-03: Document error propagation giữa các layer
- Viết ADR (Architecture Decision Record) mô tả hành vi khi mỗi layer fail
- Đặt ở docs/ADR/001-error-propagation.md
```

---

## 3. State Machine & Pipeline

### Mô tả hiện tại

Pipeline chạy theo thứ tự 7 bước:

```
Plan → Context → Generate → Check → Review → Fix → Write
```

Mỗi bước tạo artifacts trong `.ai-system-artifacts/run-<id>/`. Pipeline có thể pause ở Check hoặc Review để chờ human approval.

### Vấn đề phát hiện

**P1 — Fix loop không có hard limit documentation.**
`AI_SYSTEM_MAX_ITERATIONS=5` giới hạn số vòng fix, nhưng hành vi khi đạt limit không được mô tả rõ: dừng và báo lỗi, commit partial work, hay discard toàn bộ? Người dùng có thể mất tiền/token mà không biết kết quả.

**P2 — Không có step-level retry logic.**
Nếu bước Generate thất bại do network timeout gọi CLI, toàn bộ pipeline restart từ đầu, tốn context và token.

**P3 — Resume logic chưa rõ.**
Tài liệu nói "Runs are resumable from any paused or failed stage" nhưng không có ví dụ CLI hay test case nào minh họa điều này.

**P4 — Không có dry-run cho từng step riêng lẻ.**
Dry-run hiện tại bỏ qua Write step, nhưng không thể dry-run chỉ bước Plan để review trước khi tiếp tục.

### Tasks cho Codex

```
TASK-PIPE-01: Document và enforce behavior khi MAX_ITERATIONS đạt limit
- Khi đạt limit: ghi run-state với status="max_iterations_reached"
- Lưu partial artifacts, không discard
- In summary rõ ràng: bước nào thất bại, lý do, artifacts ở đâu
- File: ai-system/orchestrator/ (runner hoặc executor chính)

TASK-PIPE-02: Thêm step-level retry với exponential backoff
- Mỗi step có thể retry tối đa N lần (config: stepRetries, default 2)
- Backoff: 1s, 2s, 4s
- Chỉ retry với transient errors (timeout, network), không retry với logic errors

TASK-PIPE-03: Viết integration test cho resume flow
- Test: bắt đầu run → giả lập fail ở step Generate → resume → kiểm tra tiếp tục đúng từ Generate
- Không restart từ Plan

TASK-PIPE-04: Thêm --step-until flag cho CLI
- `ai run --step-until plan` → chỉ chạy đến Plan, dừng, in plan.json
- Cho phép user review plan trước khi generate code
```

---

## 4. Context Intelligence

### Mô tả hiện tại

Đây là điểm mạnh nhất của dự án. Hệ thống dùng:

- **Dependency Graph**: phân tích static imports để hiểu quan hệ giữa files
- **Vector Index**: semantic search trên codebase dùng `@xenova/transformers` (local, offline)
- **Ranked Selection**: tự động chọn files phù hợp nhất để fit trong token limit của model

### Vấn đề phát hiện

**P1 — `@xenova/transformers` là dependency nặng.**
Download model weights về local (~100-400MB tùy model). Lần đầu chạy sẽ bị block mà không có progress indicator rõ ràng. Người dùng không biết tại sao tool "không làm gì" trong 2-5 phút.

**P2 — Vector index stale sau khi codebase thay đổi.**
Không có cơ chế invalidate/rebuild index tự động khi files thay đổi. User phải biết chạy lại index thủ công.

**P3 — Không có fallback khi vector model fail.**
Nếu model download thất bại (offline, proxy), toàn bộ context intelligence bị tắt. Không rõ có fallback về keyword search hay không.

**P4 — Dependency Graph có thể sai với dynamic imports.**
Static analysis không phát hiện `require(variable)` hay `import(path)` — phổ biến trong Next.js, monorepos.

### Tasks cho Codex

```
TASK-CTX-01: Thêm progress indicator khi download model lần đầu
- Detect nếu model chưa có trong cache
- In: "Downloading embedding model (~150MB), first-time setup..."
- Show % progress nếu có thể, hoặc spinner với estimated time

TASK-CTX-02: Auto-invalidate vector index khi files thay đổi
- Lưu hash của mỗi file đã index vào index metadata
- Khi run, so sánh hash hiện tại vs hash đã lưu
- Re-index chỉ files đã thay đổi (incremental update)

TASK-CTX-03: Fallback về BM25/keyword search khi vector model unavailable
- Implement simple BM25 ranker làm fallback
- Tự động dùng nếu model download fail hoặc --no-embedding flag
- Log warning: "Embedding model unavailable, using keyword search (lower quality)"

TASK-CTX-04: Cảnh báo khi phát hiện dynamic imports trong Dependency Graph
- Scan cho pattern: require(variable), import(expression)
- Warn: "Dynamic imports detected in X files — dependency graph may be incomplete"
```

---

## 5. Agent Design

### Mô tả hiện tại

Bốn agent chuyên biệt với trách nhiệm rõ ràng:

- **Planner**: chọn files cần thay đổi, tạo execution plan
- **Generator**: viết code patches dựa trên plan và context
- **Reviewer**: kiểm tra bugs, security issues, code quality
- **Fixer**: tự sửa lỗi dựa trên feedback từ Reviewer và Check step

`AGENTS.md` định nghĩa operating rules cho agents khi chúng tự dùng repo này để phát triển — một meta-programming pattern thú vị.

### Vấn đề phát hiện

**P1 — Không có inter-agent communication logging.**
Không rõ prompt/response giữa Planner và Generator có được log đầy đủ không, khó debug khi agent làm sai.

**P2 — Reviewer prompt có thể bị echo chamber.**
Nếu cùng một model làm cả Generator lẫn Reviewer (trong profile `balanced`), reviewer ít có khả năng phát hiện blind spots của generator.

**P3 — Fixer nhận context không đầy đủ.**
Fixer nhận review comments nhưng có nhận diff của iteration trước không? Nếu không, fixer có thể repeat lỗi tương tự.

**P4 — Self-improvement loop chưa có feedback mechanism.**
`tasks/lessons.md` được cập nhật thủ công sau corrections. Không có cách tự động extract lessons từ failed runs.

### Tasks cho Codex

```
TASK-AGENT-01: Thêm full prompt/response logging cho mỗi agent invocation
- Log vào: .ai-system-artifacts/run-<id>/agent-logs/<agent>-<iteration>.jsonl
- Format: { timestamp, agent, model, prompt_tokens, response_tokens, response_summary }
- Không log full prompt (privacy), chỉ log summary và metrics

TASK-AGENT-02: Enforce different models cho Generator và Reviewer trong mọi profile
- Validate config: nếu generator_model == reviewer_model, warn
- Recommend: dùng model khác family (vd: codex cho generate, claude cho review)
- Document trong CONFIG.md tại sao điều này quan trọng

TASK-AGENT-03: Truyền full diff history vào Fixer context
- Fixer hiện tại nhận: original code + review comments
- Thêm: diff của mỗi iteration trước đó để Fixer thấy những gì đã được thử
- Giúp tránh lặp lại fix approach đã thất bại

TASK-AGENT-04: Auto-extract lessons từ failed runs
- Khi run kết thúc với status=failed, phân tích:
  * Bước nào fail
  * Error message
  * Số iterations đã thử
- Ghi vào tasks/lessons.md với template chuẩn
```

---

## 6. Server & API Layer

### Mô tả hiện tại

Orchestra có thể chạy như HTTP service trên cổng `:3927` với:

- Job queue với SSE streaming logs
- REST API đầy đủ (Jobs, Work Items, Config, Workers, Admin)
- RBAC với 3 roles: viewer, operator, admin
- Audit log cho mọi mutation

### Vấn đề phát hiện

**P1 — Không có rate limiting trên API endpoints.**
Không có mention về rate limiting trong tài liệu. Một actor có token hợp lệ có thể flood server với `POST /jobs`, gây OOM hoặc làm cạn kiệt CLI quota.

**P2 — Job queue không có priority.**
Mọi job đều bình đẳng. Không có cách ưu tiên urgent tasks hay deprioritize background work.

**P3 — SSE stream không có timeout.**
`GET /jobs/:id/stream` giữ connection mở. Nếu client disconnect ngầm (mobile, flaky network), server có leak connection không?

**P4 — `/config` POST không có schema validation.**
Update runtime config qua API có thể push invalid config mà không bị reject ngay — chỉ phát hiện khi next run.

**P5 — Worker heartbeat không có auto-disable.**
Nếu worker ngừng gửi heartbeat (crash), job bị claim bởi worker đó sẽ stuck mãi mãi trừ khi manual `POST /jobs/:jobId/recover`.

### Tasks cho Codex

```
TASK-API-01: Implement rate limiting cho POST /jobs
- Default: 10 jobs/minute per token
- Config: AI_SYSTEM_RATE_LIMIT_JOBS_PER_MIN
- Response khi exceeded: 429 Too Many Requests với Retry-After header

TASK-API-02: Thêm priority field cho jobs
- POST /jobs body: { task, priority: "low" | "normal" | "high" }
- Queue sort theo priority trước, rồi theo timestamp
- Dashboard hiển thị priority badge

TASK-API-03: Auto-disable worker sau N missed heartbeats
- Nếu worker không heartbeat trong (lease_duration * 2), tự động set status=disabled
- Jobs bị claim bởi worker disabled → tự động re-queue
- Config: AI_SYSTEM_WORKER_DEAD_TIMEOUT (default: 2x lease_duration)

TASK-API-04: Thêm JSON Schema validation cho POST /config
- Define schema đầy đủ cho .ai-system.json
- Validate trước khi apply, reject với chi tiết lỗi nếu invalid
- Reuse schema này cho `ai config validate` CLI command

TASK-API-05: Add connection cleanup cho SSE streams
- Detect client disconnect (request.on('close'))
- Cancel job stream subscription khi disconnect
- Log: "SSE client disconnected for job <id>"
```

---

## 7. Security Model

### Mô tả hiện tại

Điểm tốt đã implement:

- Bearer token bắt buộc trong server mode
- Server từ chối start nếu thiếu token
- Atomic file writes (rename pattern) để tránh corruption
- Secret redaction trong logs
- `AI_SYSTEM_ALLOWED_WORKDIRS` để restrict filesystem access
- Audit log cho mọi mutation
- Docker sandbox cho tool execution

### Vấn đề phát hiện

**P1 — Server bind `0.0.0.0` by default.**
Trong môi trường cloud/VM, server mặc định accessible từ mọi interface. Người dùng không đọc kỹ docs dễ expose token ra ngoài.

**P2 — Token chỉ là bearer string, không có expiry.**
Không có mechanism rotate token hay set expiry. Nếu token bị leak, phải thay thủ công và restart server.

**P3 — Symlink escape trong workspace validation.**
Tài liệu có nhắc đến "rejects symlink escapes" nhưng không rõ có handle tất cả edge cases (relative symlinks, chained symlinks) hay không.

**P4 — Docker sandbox không mặc định.**
`tools.sandbox.mode: "docker"` phải được set thủ công. Default là `inherit` — chạy trong host process với full filesystem access.

**P5 — Không có request signing cho worker APIs.**
Worker dùng `ORCHESTRA_WORKER_TOKEN` nhưng không có request signing (HMAC). Token bị intercept = toàn bộ worker bị compromise.

### Tasks cho Codex

```
TASK-SEC-01: Đổi default bind address từ 0.0.0.0 sang 127.0.0.1
- Breaking change — thêm AI_SYSTEM_BIND_ADDRESS env var
- Default: 127.0.0.1 (safe)
- Phải explicit set 0.0.0.0 để expose ra ngoài
- Warn rõ khi bind ra 0.0.0.0: "⚠️  Server binding to all interfaces. Ensure firewall rules are in place."

TASK-SEC-02: Thêm token expiry và rotation support
- AI_SYSTEM_SERVER_TOKEN có thể là danh sách (comma-separated)
- AI_SYSTEM_TOKEN_EXPIRES_AT: ISO timestamp, server reject token sau thời điểm này
- Endpoint: POST /admin/rotate-token (admin only) để thêm token mới và invalidate cũ

TASK-SEC-03: Warn mạnh khi Docker sandbox không được enable
- Khi server start với sandbox.mode != "docker", print warning:
  "⚠️  Running without Docker sandbox. Tool checks have full filesystem access."
- Suggest cách enable Docker sandbox

TASK-SEC-04: Audit log tất cả failed auth attempts
- Log: { timestamp, ip, endpoint, reason: "invalid_token" | "missing_token" | "expired_token" }
- Thêm vào GET /audit endpoint
- Rate limit failed auth: 10 failures/minute per IP → temporary block
```

---

## 8. Worker & Distributed Execution

### Mô tả hiện tại

Hệ thống có worker model cho phép scale out job execution:

- Workers register với server, gửi heartbeat định kỳ
- Server assign jobs cho workers qua claim API
- Worker báo cáo progress qua checkpoint và complete APIs
- `ORCHESTRA_EXECUTION_BACKEND=hybrid` là reserved, chưa implement

### Vấn đề phát hiện

**P1 — Không có worker discovery.**
Workers phải register thủ công. Không có service discovery, không hỗ trợ auto-scaling.

**P2 — Job assignment không có load balancing.**
Claim API là first-come-first-served. Không có cách direct job đến worker có cùng codebase mounted, dẫn đến worker claim job của codebase mà nó không có access.

**P3 — Checkpoint format chưa được document.**
`POST /jobs/:jobId/checkpoint` nhận gì? Schema không rõ. Không thể build external worker mà không đọc source code.

**P4 — `hybrid` mode placeholder gây nhầm lẫn.**
Config documentation liệt kê `hybrid` như một option hợp lệ nhưng nó không hoạt động. Người dùng set config này và không hiểu tại sao behavior không như mong đợi.

### Tasks cho Codex

```
TASK-WORK-01: Document và validate ORCHESTRA_EXECUTION_BACKEND=hybrid
- Thêm warning khi hybrid được set: "hybrid mode is not yet implemented, falling back to in-process"
- Hoặc remove khỏi documentation cho đến khi implement
- Tránh config option gây confusion

TASK-WORK-02: Thêm workspaceRoots matching khi claim jobs
- Job có cwd attribute
- Worker có workspaceRoots list
- Claim chỉ succeed nếu job.cwd nằm trong một workspace root của worker
- Prevent worker nhận job của codebase mà nó không mount

TASK-WORK-03: Document checkpoint API schema
- Viết OpenAPI/JSON Schema cho POST /jobs/:jobId/checkpoint body
- Bao gồm: iteration number, files changed, check results, current status
- Thêm vào docs/API.md

TASK-WORK-04: Implement basic worker health dashboard
- GET /workers → trả về list với: id, status, last_heartbeat, jobs_completed, current_job
- Dashboard hiển thị workers panel
- Highlight workers có heartbeat > 2x lease_duration
```

---

## 9. Dashboard & Observability

### Mô tả hiện tại

Dashboard React + Vite với nhiều panels:

- Jobs list với real-time status
- Work Board (Kanban)
- Inbox (import GitHub issues/PRs)
- Analytics (cost/day, failure breakdown, provider performance)
- Config editor

Work Item Detail có 7 tabs: Assessment, Task Graph, Checklist, Runs, Branch/PR, CI Checks, Actions.

### Vấn đề phát hiện

**P1 — Analytics chưa rõ data source.**
"Cost per day" — cost được tính từ đâu? Từ token count × estimated price? Có đúng không khi dùng multiple providers với giá khác nhau?

**P2 — Task Graph visual không interactive.**
Work Item detail có "Visual DAG of execution nodes" nhưng tài liệu không mô tả xem user có thể interact (click node, retry individual node) hay chỉ readonly.

**P3 — Dashboard không có authentication riêng.**
Dashboard trên `:5253` (dev) hay sau proxy không có auth riêng biệt so với API. Ai vào được dashboard, vào được API.

**P4 — Không có mobile support mention.**
Dashboard là React web app — không rõ responsive trên mobile hay chỉ desktop-optimized.

### Tasks cho Codex

```
TASK-DASH-01: Document cost calculation methodology
- Viết docs/COST-TRACKING.md giải thích:
  * Token count được lấy từ đâu (CLI response, manual count, estimate)
  * Price mapping cho từng provider
  * Accuracy limitations (estimated vs actual)
- Hiển thị "estimated" badge trong dashboard khi cost là estimate

TASK-DASH-02: Thêm export cho Analytics data
- GET /stats?format=csv → export analytics data
- Useful cho external reporting, spreadsheets
- Include: date, job_count, success_rate, total_tokens, estimated_cost

TASK-DASH-03: Document Task Graph interactivity
- Clarify: node có clickable không? Có thể retry từ giữa graph không?
- Nếu chưa implement: add to roadmap với clear label "coming in W3"
- Đừng show UI element mà không có action

TASK-DASH-04: Thêm basic auth cho dashboard route (nếu server mode)
- Khi AI_SYSTEM_SERVER_MODE=true, dashboard yêu cầu token tương tự API
- Hoặc dedicated dashboard token: AI_SYSTEM_DASHBOARD_TOKEN
```

---

## 10. Developer Experience & Onboarding

### Mô tả hiện tại

Setup hiện tại yêu cầu:

1. Node 20+, pnpm
2. Clone repo, `pnpm install`
3. Cài ít nhất một CLI (gemini, codex, claude)
4. Tạo `.ai-system.json`
5. (Optional) Docker cho sandbox
6. (Optional) Set environment variables

`ai doctor` command giúp validate setup — đây là điểm tốt.

### Vấn đề phát hiện

**P1 — Không có `npx` / one-line install.**
User phải clone repo. Không có `npm install -g orchestra-ai` hay `npx orchestra-ai init`.

**P2 — `.ai-system.json` schema không rõ ràng.**
Config file có nhiều options nhưng không có JSON Schema, IDE autocompletion, hay validator CLI rõ ràng.

**P3 — Error messages không actionable.**
Khi setup thiếu (vd: CLI không tìm thấy), error message có đủ context để user biết phải làm gì không?

**P4 — Không có example projects.**
Không có "run orchestra on this sample repo" để user thử ngay mà không cần codebase thực.

### Tasks cho Codex

```
TASK-DX-01: Tạo interactive init wizard
- Command: ai init (hoặc npx orchestra-ai init)
- Hỏi: project root, preferred provider, sandbox mode
- Auto-generate .ai-system.json với sensible defaults
- Chạy ai doctor tự động sau init

TASK-DX-02: Publish JSON Schema cho .ai-system.json
- Generate schema từ TypeScript types
- Publish tại: docs/schema/ai-system.schema.json
- Thêm vào README: hướng dẫn enable schema trong VS Code
- Thêm $schema field vào example configs

TASK-DX-03: Tạo example repository nhỏ
- Tạo folder: examples/todo-app/ với một TypeScript project đơn giản
- Bao gồm: .ai-system.json configured, README với quick-start
- Người dùng có thể clone và chạy `ai "add input validation to the login form"` ngay

TASK-DX-04: Cải thiện error messages khi thiếu CLI provider
- Hiện tại (giả sử): "Provider 'codex' not found"
- Mục tiêu: "Provider 'codex' not found. Install it with: npm install -g @openai/codex\nOr switch to another provider in .ai-system.json"
- Mỗi provider có install instruction riêng
```

---

## 11. Testing & CI/CD

### Mô tả hiện tại

Từ `docs/WORKSPACE.md`:

- Verification gates: `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run dashboard:build`, `pnpm --dir dashboard test`
- Phase W0 có 196/196 tests pass, dashboard 5/5 pass

Tuy nhiên: **không có GitHub Actions workflow nào** trong repo.

### Vấn đề phát hiện

**P1 — Không có CI pipeline.**
97 commits nhưng zero automated checks trên PRs. Không có đảm bảo tests pass trên mọi commit.

**P2 — Test coverage không rõ.**
196 tests nghe có vẻ nhiều nhưng không rõ coverage % là bao nhiêu. Có thể phần lớn là unit tests trivial.

**P3 — Không có integration test với thực tế CLI.**
Tests có mock CLI responses không? Nếu có, mock có accurate không? Nếu không, test không catch lỗi integration thực tế.

**P4 — Dashboard tests chỉ có 5 test cases.**
5 tests cho toàn bộ React dashboard là rất ít — không đủ confidence.

### Tasks cho Codex

```
TASK-TEST-01: Tạo GitHub Actions CI workflow
- File: .github/workflows/ci.yml
- Trigger: push, pull_request trên main
- Jobs:
  * typecheck: pnpm run typecheck
  * lint: pnpm run lint
  * test: pnpm test --coverage
  * dashboard-build: pnpm run dashboard:build
  * dashboard-test: pnpm --dir dashboard test
- Upload coverage report as artifact

TASK-TEST-02: Thêm coverage threshold
- Minimum coverage: 70% (có thể tăng theo thời gian)
- Fail CI nếu coverage drop dưới threshold
- Track coverage trend theo thời gian

TASK-TEST-03: Viết integration test cho happy path end-to-end
- Mock CLI subprocess calls
- Test: CLI input → pipeline execution → artifact output
- Verify: plan.json được tạo, iterations có diff, run-state.json có status=success
- Không test với real CLI (quá chậm/tốn tiền), nhưng mock phải realistic

TASK-TEST-04: Thêm test cho error cases quan trọng
- CLI provider not found → graceful error với helpful message
- MAX_ITERATIONS reached → partial artifacts saved, clear status
- Docker sandbox not available → fallback hoặc clear error
- File write permission denied → atomic write rollback

TASK-TEST-05: Tăng dashboard test coverage
- Mục tiêu: 20+ test cases cho dashboard
- Priority: Job list rendering, SSE stream updates, Config editor validation
- Tool: Vitest + Testing Library (giả sử đã có trong dashboard)
```

---

## 12. Workspace Domain Model

### Mô tả hiện tại

Hệ thống đang evolve sang "AI Software Workspace" với domain model rõ ràng:

```
Run       → đơn vị AI execution
Job       → queued request tạo ra Run
Project   → Git repository với config riêng
Work Item → durable task entity (planned W1)
Workspace → team-level governance layer
```

Future phases:

- **W1** (Active Preview): Work Items
- **W2** (Planned): Assessment + risk classification
- **W3** (Planned): Task Graph + Evidence Checklist
- **W4** (Planned): Linking runs với work items via CLI

### Vấn đề phát hiện

**P1 — Docs vs reality gap.**
W3 features (Task Graph, Evidence Checklist) được document chi tiết nhưng chưa implement. Dashboard có thể hiển thị UI elements của những features này mà chưa có action.

**P2 — Work Item migration path chưa được test.**
Tài liệu cam kết backward compatibility (old runs không cần Work Item) nhưng test có cover path này không?

**P3 — Multi-project support chưa rõ.**
`POST /projects` (admin) được nhắc đến nhưng không có document chi tiết về isolation giữa projects.

### Tasks cho Codex

```
TASK-WS-01: Đánh dấu rõ ràng features nào là "Planned" trong UI
- Bất kỳ UI element nào cho W2/W3 features phải có badge "Coming soon"
- Hoặc disable hoàn toàn và chỉ show trong docs
- Tránh confusion giữa available và aspirational

TASK-WS-02: Viết migration test cho backward compatibility
- Test: load run artifact cũ (không có Work Item link) → không bị error
- Test: run artifact mới (có Work Item link) → load đúng
- Chạy trong CI để prevent regression

TASK-WS-03: Document POST /projects API
- Viết docs/MULTI-PROJECT.md
- Mô tả: isolation boundaries, config inheritance, artifact separation
- Ví dụ: team với 3 projects setup
```

---

## 13. Danh sách việc cần làm cho Codex

Đây là tổng hợp tất cả tasks được sắp xếp theo priority. Copy từng section và đưa cho Codex xử lý độc lập.

### 🔴 Priority 1 — Critical (làm ngay)

| Task ID      | Mô tả                                              | File liên quan                          |
| ------------ | -------------------------------------------------- | --------------------------------------- |
| TASK-API-03  | Auto-disable worker sau N missed heartbeats        | server/workers/, queue/                 |
| TASK-SEC-01  | Đổi default bind từ 0.0.0.0 sang 127.0.0.1        | server/index.ts hoặc server config      |
| TASK-TEST-01 | Tạo GitHub Actions CI workflow                     | .github/workflows/ci.yml (file mới)     |
| TASK-PIPE-01 | Document và enforce behavior khi MAX_ITER đạt limit | orchestrator/runner hoặc executor       |
| TASK-CTX-01  | Progress indicator khi download model lần đầu      | context/vector-index hoặc embeddings/   |

### 🟡 Priority 2 — Important (làm trong sprint tới)

| Task ID      | Mô tả                                          | File liên quan               |
| ------------ | ---------------------------------------------- | ---------------------------- |
| TASK-API-01  | Rate limiting cho POST /jobs                   | server/routes/jobs.ts        |
| TASK-CTX-02  | Auto-invalidate vector index khi files thay đổi | context/indexer              |
| TASK-CTX-03  | Fallback BM25 khi vector model unavailable     | context/search               |
| TASK-PIPE-02 | Step-level retry với exponential backoff       | orchestrator/steps/          |
| TASK-DX-01   | Interactive init wizard                        | cli/commands/init.ts (mới)   |
| TASK-DX-02   | JSON Schema cho .ai-system.json                | docs/schema/ (mới)           |
| TASK-TEST-03 | Integration test cho happy path end-to-end     | tests/integration/ (mới)     |
| TASK-SEC-03  | Warn mạnh khi Docker sandbox không được enable | server/startup hoặc config   |
| TASK-WS-01   | Đánh dấu "Planned" features trong UI          | dashboard/src/               |

### 🟢 Priority 3 — Nice to have (backlog)

| Task ID      | Mô tả                                              |
| ------------ | -------------------------------------------------- |
| TASK-ARCH-01 | Provider health-check khi khởi động                |
| TASK-ARCH-02 | CLI version compatibility matrix                   |
| TASK-AGENT-01| Full prompt/response logging cho agents            |
| TASK-AGENT-03| Truyền full diff history vào Fixer context         |
| TASK-API-02  | Priority field cho jobs                            |
| TASK-API-04  | JSON Schema validation cho POST /config            |
| TASK-WORK-02 | workspaceRoots matching khi claim jobs             |
| TASK-WORK-03 | Document checkpoint API schema                     |
| TASK-DASH-01 | Document cost calculation methodology              |
| TASK-DX-03   | Example repository nhỏ                             |
| TASK-DX-04   | Cải thiện error messages khi thiếu provider        |
| TASK-TEST-04 | Tests cho error cases quan trọng                   |
| TASK-TEST-05 | Tăng dashboard test coverage                       |
| TASK-SEC-02  | Token expiry và rotation support                   |
| TASK-WS-02   | Migration test cho backward compatibility          |

---

## Hướng dẫn dùng file này với Codex

Copy từng task block bên dưới và đưa cho Codex với context repo:

```
# Prompt template cho Codex:

Tôi có một TypeScript project tại [repo root].
Hãy implement task sau:

[Dán nội dung task từ file này]

Yêu cầu:
- Đọc code hiện tại trước khi viết
- Viết tests cho code mới
- Không break existing functionality
- Comment code bằng tiếng Anh
```

---

*File được tạo tự động từ code review session. Cập nhật khi có thêm phát hiện mới.*
