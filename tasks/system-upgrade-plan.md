# System Upgrade Plan

**Ngay lap:** 28/04/2026  
**Pham vi:** AI-CODING-SYSTEM giai doan nang cap tiep theo sau Dashboard V3  
**Trang thai dau vao:** Code quality, lint, typecheck, test suite, dashboard build va cac P0/P1 foundation da hoan tat

---

## 1. Muc tieu giai doan tiep theo

He thong hien da vuot qua giai doan beta foundation: CLI da duoc modular hoa, lint/test/typecheck xanh, dashboard V3 da co diff viewer, SSE logs, config editor, approval workflow, analytics va cost visibility. Giai doan tiep theo nen tap trung vao viec bien AI-CODING-SYSTEM thanh mot orchestration platform co the van hanh ben vung tren nhieu project, nhieu ngon ngu va nhieu job song song.

Muc tieu chinh:

- Nang Dashboard V3 thanh control center co kha nang van hanh hang ngay, khong chi demo/monitor.
- Hoan thien queue/server orchestration de chay nhieu job, nhieu workspace an toan.
- Mo rong ecosystem ngoai TypeScript/Node.js bang adapter va parser chat luong cao.
- Tang kha nang quan sat, truy vet chi phi, token usage va failure patterns.
- Them co che plugin/tool extensibility de tuy bien workflow theo tung repo.
- Hardening cac duong dan resume, cancel, approval va artifact apply cho production use.

---

## 2. Current Baseline

### Da hoan tat

- CLI god file da duoc modular hoa thanh parser, handlers, formatters va supporting modules.
- ESLint, Prettier, lint script va dependency classification da duoc thiet lap.
- Test coverage da bo sung cho provider-router, run-executor, context-intelligence, agents va integration flow.
- Execution state machine da dieu phoi planning, context, generation, checks, review, write va memory store.
- Artifact system ho tro resume, retry, checkpoint, apply audit va editable checkpoint artifacts.
- Vector context da co ranking, dependency expansion, AST/line-based symbol chunking va Tree-sitter fallback.
- Tool execution da co sandbox modes: inherit, clean-env va docker.
- Non-Node adapters da co baseline cho Python, Go va Rust.
- Provider routing da co adaptive history, category-aware scoring va budget penalty.
- Prompt override system da ho tro custom templates va examples.
- Server mode da co sync `/run` va file-backed queue API.
- Dashboard V3 da co live logs, diff modal, config editor, approval control va analytics.

### Rủi ro còn lại

- Dashboard bundle con lon, Vite build canh bao chunk size lon.
- Queue/server mode moi o muc file-backed local queue, chua co concurrency governance va multi-project UX day du.
- Cross-language support moi o baseline, chua co adapter sau cho ruff, mypy, go vet, golangci-lint, cargo clippy.
- Cost/token tracking da co, nhung chua co governance cap workspace/team, alerts hoac trend analysis.
- Error classification va retry policy can duoc ap dung dong nhat hon qua provider, tool, server va dashboard.
- Plugin/tool execution con can interface on dinh de nguoi dung mo rong khong sua core.

---

## 3. Upgrade Themes

## Theme A: Dashboard V4 - Production Control Center

**Priority:** P0  
**Impact:** High  
**Effort:** 5-7 ngay

### Muc tieu

Bien dashboard thanh noi dieu phoi job thuc te cho local/server mode, tap trung vao job lifecycle, approval, artifact inspection, cost visibility va multi-project awareness.

### Deliverables

- [ ] Tach dashboard bundle bang route-level/code splitting va dynamic imports cho diff viewer, charts, config editor.
- [ ] Them Jobs board voi queue states ro rang: queued, running, waiting_for_approval, completed, failed, cancel_requested, cancelled.
- [ ] Them filters theo status, provider, workspace, date range va cost range.
- [ ] Them detail panel cho execution stages, transition timeline, retry target va artifact links.
- [ ] Them approval UI co diff/context preview truoc khi approve plan hoac generation checkpoint.
- [ ] Them budget panel hien thi max duration, max cost, estimated current cost va budget exceeded reason.
- [ ] Them run comparison view giua latest run va previous successful run khi artifact co du lieu.
- [ ] Them empty/error/loading states chuan cho tat ca dashboard views.

### Verification

- [ ] `pnpm run dashboard:build` pass va bundle warning duoc giam hoac co chunking hop ly.
- [ ] `pnpm run typecheck` pass.
- [ ] `pnpm run lint` pass.
- [ ] Dashboard manual smoke: open jobs list, inspect job detail, stream logs, approve/reject checkpoint.

---

## Theme B: Queue And Multi-Project Orchestration

**Priority:** P0  
**Impact:** High  
**Effort:** 5-8 ngay

### Muc tieu

Lam server queue an toan hon cho nhieu job va nhieu workspace, voi concurrency, cancellation va persistence dang tin cay.

### Deliverables

- [ ] Them queue scheduler co concurrency per server va optional concurrency per workspace.
- [ ] Them workspace allowlist validation nhat quan cho create/list/get job.
- [ ] Them job lease/heartbeat de phat hien job running bi crash.
- [ ] Them retry policy cho job failed theo failure class.
- [ ] Them cancel propagation tu HTTP API vao execution state machine va provider/tool subprocess.
- [ ] Them job retention policy: keep last N jobs hoac jobs trong N ngay.
- [ ] Them project registry local de dashboard list duoc cac workspace da cau hinh.
- [ ] Them server health detail: active jobs, queued jobs, allowed workdirs, queue concurrency, storage path.

### Verification

- [ ] Unit tests cho scheduler, retention, cancellation va workspace validation.
- [ ] Integration smoke cho create/list/get/cancel job.
- [ ] Manual smoke server `/health`, `/jobs`, `/jobs/:id`, `/jobs/:id/cancel`.

---

## Theme C: Cross-Language Execution V2

**Priority:** P1  
**Impact:** High  
**Effort:** 6-10 ngay

### Muc tieu

Dua verified execution ra ngoai Node.js/TypeScript voi adapter chat luong cao cho Python, Go va Rust, thay vi chi baseline test command.

### Deliverables

- [ ] Python adapter V2: detect `ruff`, `mypy`, `pytest`, `uv`, `poetry`, `pipenv`.
- [ ] Go adapter V2: detect `go test`, `go vet`, `golangci-lint`, module/package scoping.
- [ ] Rust adapter V2: detect `cargo test`, `cargo clippy`, workspace members va package scoping.
- [ ] Them changed-file scoping rules rieng cho Python/Go/Rust.
- [ ] Them Docker image profile docs va default commands cho tung ecosystem.
- [ ] Them artifact summary hien thi detected language adapter va selected commands.
- [ ] Them parser confidence signal cho context ranking khi Tree-sitter co/khong co.

### Verification

- [ ] Fixture repos nho cho Python, Go, Rust.
- [ ] Tests cho command detection, scoping va fallback behavior.
- [ ] Docker sandbox smoke cho moi ecosystem neu image co san.

---

## Theme D: Observability, Cost Governance And Reporting

**Priority:** P1  
**Impact:** Medium-High  
**Effort:** 4-6 ngay

### Muc tieu

Bien token/cost tracking thanh cong cu quan tri: biet job nao ton chi phi, provider nao loi nhieu, stage nao cham va budget nao bi vuot.

### Deliverables

- [ ] Persist normalized provider usage events per stage vao artifacts.
- [ ] Them cost report trong `ai runs latest/show` gom input tokens, output tokens, estimated cost, provider, model.
- [ ] Them dashboard charts cho cost over time, failures by class, average duration by stage.
- [ ] Them budget warning truoc generation khi estimated context size vuot nguong.
- [ ] Them config cap workspace cho max daily cost va max single-run cost.
- [ ] Them adaptive routing signal dua tren cost efficiency theo task category.
- [ ] Them JSON export cho run analytics de automation doc duoc.

### Verification

- [ ] Tests cho cost aggregation khi provider co usage va khi provider khong co usage.
- [ ] Tests cho budget exceeded classification.
- [ ] Manual smoke `ai runs latest --json` va dashboard analytics.

---

## Theme E: Error Classification And Recovery Hardening

**Priority:** P1  
**Impact:** High  
**Effort:** 4-7 ngay

### Muc tieu

Lam retry/resume decisions nhat quan bang typed error taxonomy va failure metadata co the doc duoc tu CLI, dashboard va artifacts.

### Deliverables

- [ ] Tao error taxonomy chuan cho ProviderTimeout, ProviderResponse, ToolExecution, ContextOverflow, BudgetExceeded, UserCancelled, ApprovalRejected, ArtifactCorrupt.
- [ ] Chuan hoa failure class trong execution summary va server job result.
- [ ] Ap dung retryability rules theo error class.
- [ ] Them resume hints ro rang cho tung failure class.
- [ ] Them artifact validation truoc khi resume/apply tu checkpoint.
- [ ] Them dashboard failure panel hien thi root cause, retry target va suggested action.
- [ ] Them tests cho corrupted artifact, cancelled job, rejected approval va tool timeout.

### Verification

- [ ] Unit tests cho classifyError va retry decision.
- [ ] Integration tests cho resume tu failed stage.
- [ ] Manual smoke `ai retry last --stage <stage>` sau mot failed run co artifact.

---

## Theme F: Plugin And Tool Extensibility

**Priority:** P2  
**Impact:** Medium  
**Effort:** 6-9 ngay

### Muc tieu

Cho phep repo tuy bien tool checks, adapters, prompt packs va validators ma khong can sua core.

### Deliverables

- [ ] Dinh nghia plugin manifest schema cho local plugins.
- [ ] Ho tro plugin discovery tu `.ai-system/plugins` va global config safe path.
- [ ] Cho plugin dang ky tool adapter, validation command, prompt templates va dashboard metadata.
- [ ] Them `ai plugins list` va `ai plugins doctor`.
- [ ] Them sandbox/path safety validation cho plugin commands.
- [ ] Them example plugin: Python quality pack hoac strict reviewer pack.
- [ ] Document plugin lifecycle va security model.

### Verification

- [ ] Schema tests cho plugin manifest.
- [ ] Tests cho plugin discovery va invalid path rejection.
- [ ] Smoke voi example plugin trong fixture repo.

---

## 4. Suggested Execution Order

### Milestone 1: Production Operations Baseline

- [ ] Theme A dashboard bundle/jobs/detail hardening.
- [ ] Theme B queue scheduler, cancellation va health detail.
- [ ] Theme E initial error taxonomy cho job/server/execution summary.

**Exit criteria:** dashboard co the dieu phoi job end-to-end va server queue khong con chi la basic local queue.

### Milestone 2: Verified Execution Beyond Node

- [ ] Theme C adapters V2 cho Python, Go, Rust.
- [ ] Theme D cost report trong CLI/artifacts/dashboard.
- [ ] Theme E resume/apply artifact validation.

**Exit criteria:** mot repo Python/Go/Rust nho co the duoc plan/generate/check/review voi command selection hop ly va artifact ro rang.

### Milestone 3: Extensibility And Governance

- [ ] Theme F plugin manifest va discovery.
- [ ] Theme D workspace/team budget policy.
- [ ] Dashboard analytics trend views.

**Exit criteria:** nguoi dung co the mo rong workflow bang plugin local va quan sat chi phi/failure theo thoi gian.

---

## 5. Priority Matrix

| Workstream | Priority | Impact | Effort | Recommended order |
|---|---:|---:|---:|---:|
| Dashboard V4 control center | P0 | High | Medium | 1 |
| Queue and multi-project orchestration | P0 | High | Medium | 2 |
| Error classification and recovery | P1 | High | Medium | 3 |
| Cross-language execution V2 | P1 | High | Medium-High | 4 |
| Observability and cost governance | P1 | Medium-High | Medium | 5 |
| Plugin/tool extensibility | P2 | Medium | Medium-High | 6 |

---

## 6. Non-Goals For This Phase

- Khong viet lai orchestrator tu dau.
- Khong thay doi provider architecture neu registry hien tai van dap ung duoc.
- Khong them database server bat buoc; file-backed storage van nen la default local-first.
- Khong toi uu dashboard bang cach loai bo tinh nang da co cua V3.
- Khong mo rong sang ngon ngu moi ngoai Python/Go/Rust truoc khi adapters V2 on dinh.

---

## 7. Engineering Standards

Moi slice nang cap nen tuan theo cac dieu kien sau:

- Thay doi nho, co test truc tiep, khong refactor rong neu khong can.
- Cap nhat README hoac docs khi thay doi CLI/API/config behavior.
- Cap nhat `tasks/todo.md` voi checklist va review result khi thuc hien.
- Chay quality gates truoc khi danh dau hoan tat:
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm test`
  - `git diff --check`
  - `pnpm run dashboard:build` khi cham dashboard
- Neu co server/dashboard thay doi, chay them smoke test cho `/health` va job API lien quan.

---

## 8. Immediate Next Slice Recommendation

Nen bat dau bang **Dashboard V4 + Queue Operations Slice** vi day la diem noi truc tiep giua cac nang luc da co: server queue, artifacts, approval, SSE logs, cost metrics va execution state machine.

Scope de lam truoc:

- [ ] Dashboard job board co status filters va job detail timeline.
- [ ] Server health detail tra ve active/queued jobs va queue config.
- [ ] Queue cancellation propagation va cancelled state artifact.
- [ ] Code splitting cho dashboard diff viewer/charts/config editor.
- [ ] Tests cho cancellation va dashboard data mapping.

Ket qua mong doi: nguoi dung co the mo dashboard, tao/chay job, xem logs, approve/reject checkpoint, cancel job va inspect artifact/failure trong mot workflow lien mach.
