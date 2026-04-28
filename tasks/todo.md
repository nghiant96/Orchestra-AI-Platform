# P0: Code Quality Foundation

## Tasks

### Phase 1: Modularization & Linting [DONE]
- [x] Tách `cli.ts` thành `cli/types.ts`, `cli/presets.ts`, `cli/arg-parser.ts`, vv...
- [x] Chạy thử CLI đảm bảo tương thích ngược
- [x] Thêm cấu hình ESLint chuẩn (`eslint.config.js`)
- [x] Thêm cấu hình Prettier chuẩn (`.prettierrc`, `.prettierignore`)
- [x] Fix các lỗi dependency (`@types/blessed`)

### Phase 2: Test Coverage [DONE]
- [x] Update `ai-system/core/provider-router.ts` unit tests (`provider-router.test.ts`)
- [x] Update `ai-system/core/run-executor.ts` unit tests (`run-executor.test.ts`)
- [x] Update `ai-system/core/context-intelligence.ts` unit tests (`context-intelligence.test.ts`)
- [x] Update `ai-system/agents/*.ts` unit tests (`agents.test.ts`)
- [x] Create Integration Tests (`orchestrator-integration.test.ts`)
- [x] Establish test configurations for `node:test` + `tsx`.

## Status: Completed

---

# Review Gemini Fixes Against Review_v4

## Tasks

- [x] Read `Review_v4.md` P0/P1 checklist
- [x] Map current changed files to review items
- [x] Inspect implementation and test changes
- [x] Run relevant quality gates
- [x] Record review result and remaining risk

## Review Result

- `pnpm run typecheck`: pass.
- `pnpm run lint`: pass.
- `pnpm test`: pass, 108/108 tests.
- `git diff --check`: fail due trailing whitespace in `eslint.config.js`.
- Review_v4 P0 items are functionally addressed by the Gemini patch, except the whitespace hygiene issue above.
