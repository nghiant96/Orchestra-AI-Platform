# AI-CODING-SYSTEM: Technical Review V4 — Full Codebase Audit

**Ngày đánh giá:** 28/04/2026  
**Đánh giá bởi:** Deep review toàn bộ source code, tests, types, config  
**Trạng thái tổng:** 4.0/5 — Kiến trúc tốt, nhưng có 24/106 test fail, ESLint chưa cài, và vẫn còn nợ kỹ thuật cần xử lý trước khi gọi là "production-ready".

---

## 1. Tóm tắt hiện trạng

### ✅ Điểm mạnh (đã giải quyết từ V2/V3)

| Hạng mục | Trạng thái |
|---|---|
| God-file `cli.ts` | ✅ Đã tách thành `cli/arg-parser.ts`, `cli/presets.ts`, `cli/formatters.ts`, `cli/interactive.ts`, `cli/setup.ts`, `cli/types.ts` |
| Type system | ✅ `types.ts` rất chi tiết (547 dòng), type-safe với `ProviderRole`, `ExecutionStage`, `FailureClass` |
| Provider abstraction | ✅ `JsonProvider` interface + `UsageTrackingProvider` decorator + factory `createProvider()` |
| Prompt externalization | ✅ Đã chuyển ra `prompts/*.md` + `prompt-loader.ts` (compilePrompt/loadPromptTemplate) |
| Execution state machine | ✅ Có `execution-state-machine.ts` + `execution-summary.ts` cho resume/retry |
| Artifacts & Resume | ✅ `artifacts.ts` (34KB), `run-state.json` persistence, resume strategy resolver |
| Context Intelligence | ✅ AST chunking (VectorIndex), dependency graph, ranked context selection |
| Routing & Adaptive | ✅ `provider-router.ts` (850 dòng) — signal-based, adaptive history learning |
| Memory system | ✅ `MemoryAdapter` interface với 2 backend (local-file, openmemory) |
| Test coverage | ✅ 26 test files, 106 test cases, 82 passing |

---

## 2. 🔴 Vấn đề nghiêm trọng cần sửa ngay (P0)

### 2.1 ESLint chưa được cài đặt

**Hiện trạng:** `eslint.config.js` tồn tại, `package.json` có script `lint`, nhưng **ESLint và các plugin chưa được cài vào `devDependencies`**.

```
$ pnpm run lint
sh: eslint: command not found
```

**`package.json` thiếu:**
```json
// devDependencies hiện tại chỉ có:
"@types/node", "tsx", "typescript"

// Cần thêm:
"@eslint/js", "typescript-eslint", "eslint-config-prettier", "eslint"
```

**Hệ quả:** `Review_v3.md` ghi "Đã có ESLint, Prettier" nhưng thực tế linting **hoàn toàn không hoạt động**. CI pipeline nếu có sẽ fail hoặc skip.

### 2.2 Test Suite Regression — 24/106 tests đang FAIL

| Cluster lỗi | Số test fail | Nguyên nhân gốc |
|---|---|---|
| `context-intelligence.test.ts` | 1 (crash) | `rankContextCandidates` và `trimRankedCandidatesByBudget` **không được export** khỏi module nhưng test cố import chúng |
| `tool-executor.test.ts` | 5 | Assertion failures trên auto-detection logic (scoped scripts, workspace filters, sandbox mode) |
| `config-workflow.test.ts` | 3 | `loadRules` và `writeProjectPreset` thay đổi API nhưng tests chưa update |
| `orchestrator.resume.test.ts` | 5 | `loadMergedRules` API change, tests đang gọi sai signature |
| `orchestrator-runtime.test.ts` | 1 | Budget-exceeded scenario test không match behavior mới |
| `fix-checks.test.ts` / `fix-from-run.test.ts` | 4 | Import path hoặc function signature đã thay đổi |
| `agents.test.ts` | 1 | `GeneratorAgent` test expect prompt format khác |
| `artifact-apply.test.ts` | 1 | File structure mismatch |
| `artifacts.test.ts` | 1 | CLI `runs show --json --save` command fails |
| `review-failing-checks.test.ts` | 1 | Import/API mismatch |

**Phân loại:**
- **~7 test:** Lỗi do module export thay đổi (thiếu export, thay đổi function signature) → sửa đơn giản
- **~5 test:** `tool-executor` logic regression → cần debug kỹ 
- **~12 test:** Test chưa update theo refactor gần nhất → cần synchronize

### 2.3 TypeScript Compilation Errors (3 errors)

```
tests/context-intelligence.test.ts(5,3): error TS2459: 'rankContextCandidates' ... not exported
tests/context-intelligence.test.ts(6,3): error TS2459: 'trimRankedCandidatesByBudget' ... not exported
tests/context-intelligence.test.ts(25,56): error TS7006: Parameter 'c' implicitly has 'any'
```

Chỉ ảnh hưởng test file, nhưng cho thấy **typecheck đang red** — vi phạm chính nguyên tắc "Verified Execution Pipeline" của hệ thống.

---

## 3. 🟡 Nợ kỹ thuật trung hạn (P1)

### 3.1 `cli.ts` vẫn còn 702 dòng

Dù đã extract ra các module con, file `cli.ts` chính vẫn là dispatcher khá lớn (702 dòng). Hàm `runCliCommand()` chứa switch-case khổng lồ (358 dòng) xử lý 12 command types. Nên tách thêm thành command handler riêng cho mỗi group (config, runs, fix, review).

### 3.2 `formatters.ts` là God File mới — 915 dòng, 20+ hàm

Tất cả formatting logic đổ vào 1 file duy nhất. Cần tách theo domain:
- `formatters/result.ts` — printResult, printRecentRunSummary
- `formatters/review.ts` — printCurrentChangeReviewResult, printFailingChecksReviewResult
- `formatters/config.ts` — printDoctor, printConfigShow, printSetupCheck
- `formatters/runs.ts` — printRunList, printRetryResult

### 3.3 Agent layer quá mỏng — "Thin Wrapper" problem (từ V3, chưa giải quyết)

Cả 4 agents (`planner.ts`, `generator.ts`, `reviewer.ts`, `fixer.ts`) có pattern gần giống hệt nhau:

```typescript
// Tất cả đều: load template → compile → JSON.stringify input → runJson
const template = await loadPromptTemplate("...");
const systemPrompt = compilePrompt(template, {...});
const prompt = JSON.stringify({...}, null, 2);
return this.provider.runJson({...});
```

- **Không có self-reflection/self-correction** trước khi trả kết quả
- **Không validate output** beyond JSON schema (ví dụ: reviewer trả issue cho file không tồn tại)
- **Không có few-shot examples** trong prompts
- Generator prompt có TODO comment: `// TODO: Add project rules summary if needed`

### 3.4 Prompt templates quá sơ sài

| Prompt | Dòng | Vấn đề |
|---|---|---|
| `planner.md` | 7 | Thiếu ví dụ output format, thiếu hướng dẫn về trade-off (many files vs few files) |
| `generator.md` | 9 | Có biến `{{rules_summary}}` nhưng luôn truyền empty string |
| `reviewer.md` | 11 | Tốt nhất trong 4, nhưng thiếu hướng dẫn về false positive filtering |
| `fixer.md` | 7 | Quá ngắn, thiếu hướng dẫn về scope của fix (chỉ fix issue được report, không sáng tạo thêm) |

### 3.5 Cost Tracking — có khung nhưng chưa hoàn thiện

Tích cực:
- `UsageTrackingProvider` đã wrap token estimation (estimateTokenCount)
- `ProviderUsageMetric` type đã định nghĩa
- `ExecutionBudgetSummary` có `max_cost_units`, `totalCostUnits`
- `PROVIDER_COST_UNITS` hardcoded (`codex-cli: 1`, `gemini-cli: 1.1`, `claude-cli: 1.5`)

Thiếu:
- ❌ Chưa có cost calculator thực tế (hiện dùng `duration * costUnit` thay vì token-based)
- ❌ `getUsage()` trên `UsageTrackingProvider` đã implement nhưng **chưa được gọi** ở bất kỳ đâu trong orchestrator
- ❌ Không có "budget guard" cảnh báo trước khi chạy
- ❌ `estimateTokenCount` chỉ đếm chars/4, không phải tokenizer thực

### 3.6 Vector Index bị lock vào TypeScript AST

`vector-index.ts` dùng `import ts from "typescript"` trực tiếp cho `detectSymbolRanges()`. Mặc dù `DEFAULT_SUPPORTED_EXTENSIONS` liệt kê `.py`, `.go`, `.rs`, `.java`, `.kt`, `.swift` — nhưng **symbol detection (AST chunking) chỉ hoạt động với `.ts/.tsx/.js/.jsx`**. Các ngôn ngữ khác fallback về `chunkTextFixed` (chunking dạng sliding window thuần text), **mất hoàn toàn khả năng hiểu cấu trúc code**.

---

## 4. 🟢 Các điểm ổn, không cần can thiệp

### 4.1 Architecture patterns

- **Dependency Injection:** Agents nhận `AgentDependencies` (provider + rules) — tách biệt logic khỏi infra
- **State Machine pattern:** `ExecutionStage` + `ExecutionTransition` cho phép resume/retry ở mọi giai đoạn
- **Adapter pattern:** `MemoryAdapter`, `JsonProvider` — swap backend không ảnh hưởng logic

### 4.2 Provider system

- 4 provider types: `codex-cli`, `gemini-cli`, `claude-cli`, `openai-compatible`
- `OpenAICompatibleProvider` xử lý cả JSON response lẫn SSE streaming
- Retry với exponential backoff, retryable error detection (429, 5xx)

### 4.3 Tool execution pipeline

- Auto-detect `package.json` scripts, package manager (pnpm/yarn/npm)
- Workspace-scoped execution (pnpm workspace filters)
- Docker sandbox mode
- JSON validation built-in

### 4.4 CLI feature richness

CLI rất mature với đầy đủ:
- `ai review --staged / --base / --failing-checks / --files`
- `ai fix --from-run / fix-checks`
- `ai retry <target> --stage <stage>`
- `ai setup / doctor / config show/use`
- `ai runs latest/list/show`
- `ai apply --from-artifact`
- `--json --save` output mode

---

## 5. Lộ trình ưu tiên hoàn thiện

### Immediate (sửa trong 1-2 ngày)

| # | Task | Effort | Impact |
|---|---|---|---|
| 1 | **Cài ESLint dependencies** vào `devDependencies` và fix lint errors | 30 phút | Unblocks CI pipeline |
| 2 | **Fix 3 TypeScript errors** — export `rankContextCandidates` + `trimRankedCandidatesByBudget` + type annotation | 15 phút | Typecheck green |
| 3 | **Triage và fix 24 failing tests** theo cluster ở mục 2.2 | 2-4 giờ | Test suite green |

### Short-term (1-2 tuần)

| # | Task | Effort | Impact |
|---|---|---|---|
| 4 | **Tách `formatters.ts`** thành 4 module nhỏ | 1-2 giờ | Maintainability |
| 5 | **Tách `runCliCommand()`** trong `cli.ts` thành command handlers | 2-3 giờ | Maintainability |
| 6 | **Nâng prompt quality** — thêm few-shot examples, fix `{{rules_summary}}` TODO | 2-3 giờ | Output quality ↑ |
| 7 | **Wire `getUsage()` vào orchestrator** — aggregate và report token consumption | 1-2 giờ | Cost visibility |

### Medium-term (3-4 tuần)

| # | Task | Effort | Impact |
|---|---|---|---|
| 8 | **Multi-language AST** — Plugin interface cho VectorIndex symbol detection (Tree-sitter) | 1-2 tuần | Python/Go/Rust support |
| 9 | **Agent self-reflection** — Thêm output validation layer trước khi trả kết quả | 3-5 ngày | Reliability ↑ |
| 10 | **Real cost calculator** — token-based pricing per model, pre-run budget estimation | 2-3 ngày | Cost control |
| 11 | **Universal tool adapter** — Config-driven command resolution per language/project type | 3-5 ngày | Multi-language support |

---

## 6. Kết luận

Hệ thống có **kiến trúc rất tốt**: type-safe, modular, có state machine, có resume/retry, có adaptive routing, có semantic search. Đây là nền tảng vững chắc.

Tuy nhiên, **chất lượng runtime đang bị suy giảm** do:
1. Test suite đang red (23% fail rate)
2. Linting hoàn toàn không chạy (thiếu dependencies)
3. TypeScript compilation có errors

Ưu tiên #1 tuyệt đối trước khi làm bất cứ feature mới nào: **đưa cả 3 quality gate (typecheck, test, lint) về green**. Đây chính là nguyên tắc "Verified Execution Pipeline" mà hệ thống tự enforce cho AI — bản thân nó cũng phải tuân thủ.

---
*Tài liệu V4 — Full codebase audit, 28/04/2026*
