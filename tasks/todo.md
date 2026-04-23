# P0: Code Quality Foundation

## Tasks

### 1. Tách cli.ts thành modules
### Task 1: Module Extraction & Wire-up [DONE]
- [x] Tạo `cli/types.ts`
- [x] Tạo `cli/presets.ts`
- [x] Tạo `cli/arg-parser.ts`
- [x] Tạo `cli/interactive.ts`
- [x] Tạo `cli/formatters.ts`
- [x] Cập nhật lại `cli.ts` thành file wrapper mỏng (đã refactor logic routing vào cli.ts thay vì tạo thêm `cli/main.ts` thừa thãi)

### Task 2: Testing & Validation [DONE]
- [x] Chạy thử CLI đảm bảo tương thích ngược (`npm run typecheck` thành công)
- [x] Viết unit tests cho `arg-parser.ts` và `presets.ts`

### Task 3: Linting & Code Standardization [DONE]
- [x] Sửa lỗi dependency (chuyển `@types/blessed` sang `devDependencies`)
- [x] Thêm cấu hình ESLint chuẩn (`eslint.config.js`)
- [x] Thêm cấu hình Prettier chuẩn (`.prettierrc`, `.prettierignore`)
- [x] Bổ sung script `lint` và `format` vào `package.json`ckage.json
- [ ] Fix lint/format errors

### 3. Fix dependency classification
- [ ] Move @types/blessed to devDependencies

## Status: In Progress
