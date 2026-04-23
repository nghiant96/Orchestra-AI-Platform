# P0: Code Quality Foundation

## Tasks

### 1. Tách cli.ts thành modules
- [ ] Đọc và phân tích dependency graph bên trong cli.ts
- [ ] Tạo cấu trúc `ai-system/cli/` directory
- [ ] Extract types → `cli/types.ts`
- [ ] Extract arg parsing → `cli/arg-parser.ts`
- [ ] Extract commands → `cli/commands.ts`
- [ ] Extract interactive session → `cli/interactive.ts`
- [ ] Extract setup wizard → `cli/setup.ts`
- [ ] Extract formatters/display → `cli/formatters.ts`
- [ ] Extract presets → `cli/presets.ts`
- [ ] Wire up → `cli/main.ts`
- [ ] Update entry point imports
- [ ] Verify typecheck passes

### 2. Thêm ESLint + Prettier
- [ ] Install dependencies
- [ ] Create eslint.config.js
- [ ] Create .prettierrc
- [ ] Add scripts to package.json
- [ ] Fix lint/format errors

### 3. Fix dependency classification
- [ ] Move @types/blessed to devDependencies

## Status: In Progress
