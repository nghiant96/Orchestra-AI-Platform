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
