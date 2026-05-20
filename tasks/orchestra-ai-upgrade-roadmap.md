# Orchestra AI Platform — Roadmap nâng cấp để Dev chỉ giám sát AI code

## 1. Mục tiêu

Mục tiêu của bản nâng cấp là biến **Orchestra AI Platform** từ một local AI coding orchestrator thành một **AI Engineering Workspace** có khả năng:

- Dev tạo task/issue.
- AI tự inspect repo.
- AI tự chia task lớn thành nhiều bước nhỏ.
- AI tự lập plan và yêu cầu approve nếu rủi ro cao.
- AI tự sửa code trong worktree/branch riêng.
- AI tự chạy lint/typecheck/test/build.
- AI tự đọc lỗi, phân loại lỗi và fix lại.
- AI tự tạo PR, theo dõi CI, sửa CI fail.
- Dev chủ yếu chỉ giám sát plan, approve thay đổi rủi ro cao, review PR và merge.

Định hướng đúng:

> Orchestra không nên thay thế Codex/Claude/Gemini. Orchestra nên là lớp điều phối, safety, memory, workflow, artifact, CI repair và dashboard nằm trên các AI coding CLI/model provider.

---

## 2. Trạng thái kỳ vọng sau nâng cấp

### Trước nâng cấp

```txt
AI hỗ trợ code từng task:        ~75%
AI tự sửa lỗi check local:       ~70%
AI tự xử lý issue → PR:          ~55%
AI tự theo CI và fix lại:        ~40–50%
Dev chỉ giám sát toàn bộ flow:   ~50–60%
```

### Sau nâng cấp mục tiêu

```txt
AI hỗ trợ code từng task:        85–90%
AI tự sửa lỗi check local:       ~85%
AI tự xử lý issue → PR:          ~80%
AI tự theo CI và fix lại:        ~75%
Dev chỉ giám sát toàn bộ flow:   75–85%
```

---

## 3. Workflow mục tiêu

```txt
User / GitHub Issue
        ↓
Import Work Item
        ↓
Inspect Repo Context
        ↓
Generate Task Graph
        ↓
Generate Plan + Risk Assessment
        ↓
Human Approval nếu cần
        ↓
Create Worktree + Branch
        ↓
Implement từng Task Node
        ↓
Run Scoped Verification
        ↓
Parse Error Logs
        ↓
Self Repair Loop
        ↓
AI Review
        ↓
Evidence Checklist
        ↓
Create Commit + PR
        ↓
Watch CI
        ↓
CI Auto Repair nếu fail
        ↓
Request Human Review
```

---

## 4. Các module cần thêm hoặc nâng cấp

## 4.1. Project Profile

### Mục tiêu

Mỗi repo cần có file cấu hình riêng để Orchestra hiểu dự án ngay từ đầu, không cần dev giải thích lại mỗi lần.

### File đề xuất

```yaml
# .orchestra/project.yaml
project:
  name: healthos-mobile
  type: react-native
  packageManager: pnpm
  nodeVersion: 20

commands:
  install: pnpm install
  lint: pnpm lint
  typecheck: pnpm typecheck
  test: pnpm test
  iosBuild: pnpm ios:build
  androidBuild: pnpm android:build

paths:
  app: packages/mobile
  core: packages/core
  ios: packages/mobile/ios
  android: packages/mobile/android

rules:
  noTouch:
    - .env
    - .env.*
    - ios/Pods
    - android/.gradle
    - node_modules
  requireApproval:
    - package.json
    - pnpm-lock.yaml
    - yarn.lock
    - package-lock.json
    - ios/**
    - android/**
    - Podfile
    - Podfile.lock
    - build.gradle
    - settings.gradle
    - AndroidManifest.xml

verification:
  default:
    - typecheck
    - lint
  reactNative:
    - metroCheck
    - typecheck
    - lint
  nativeChange:
    - iosBuild
    - androidBuild
```

### Tasks triển khai

- [ ] Tạo schema cho `.orchestra/project.yaml`.
- [ ] Tạo loader đọc project profile.
- [ ] Validate config bằng Zod hoặc JSON Schema.
- [ ] Cho phép override command qua CLI flag.
- [ ] Inject project profile vào planner/generator/reviewer/fixer.
- [ ] Hiển thị project profile trong dashboard.

### Acceptance Criteria

- Orchestra tự detect project profile khi chạy trong repo.
- Nếu thiếu file config, Orchestra tạo gợi ý config mặc định.
- Planner biết command nào cần chạy cho từng loại task.
- Risk policy đọc được `noTouch` và `requireApproval`.

---

## 4.2. Task Graph thật

### Mục tiêu

AI không chỉ xử lý một prompt lớn, mà phải chia task thành nhiều node nhỏ có dependency, trạng thái, evidence và retry riêng.

### Type đề xuất

```ts
export type TaskNodeStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'skipped';

export type TaskNodeType =
  | 'inspect'
  | 'design'
  | 'implement'
  | 'test'
  | 'verify'
  | 'review'
  | 'fix'
  | 'handoff';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  type: TaskNodeType;
  dependsOn: string[];
  status: TaskNodeStatus;
  expectedFiles?: string[];
  riskLevel: RiskLevel;
  requiredEvidence: EvidenceItem[];
  attempts: number;
  maxAttempts: number;
  result?: TaskNodeResult;
}

export interface TaskGraph {
  id: string;
  workItemId: string;
  nodes: TaskNode[];
  createdAt: string;
  updatedAt: string;
}
```

### Ví dụ task graph

```txt
Task: Add Google Login

1. Inspect auth flow hiện tại
2. Inspect navigation sau login
3. Kiểm tra package Google Sign-In đã có chưa
4. Đề xuất native config cần sửa
5. Implement auth service
6. Gắn UI login button
7. Update token handling
8. Viết hoặc cập nhật test
9. Chạy typecheck/lint
10. Chạy iOS/Android verification nếu native config đổi
11. Review diff
12. Tạo PR summary
```

### Tasks triển khai

- [ ] Tạo `TaskGraphBuilder` dùng planner output.
- [ ] Tạo `TaskGraphExecutor` chạy node theo dependency.
- [ ] Lưu trạng thái node vào database/file state.
- [ ] Cho phép retry từng node riêng.
- [ ] Cho phép resume task graph sau crash.
- [ ] Hiển thị graph trong dashboard.

### Acceptance Criteria

- Một task lớn được chia thành nhiều node nhỏ.
- Node fail không làm mất toàn bộ run.
- Có thể resume từ node fail.
- Dashboard hiển thị node nào đang chạy, node nào block, node nào done.

---

## 4.3. Definition of Done theo task type

### Mục tiêu

AI không được tự báo xong bằng cảm tính. Mỗi loại task phải có chuẩn hoàn thành rõ ràng.

### Đề xuất

```ts
export type WorkItemType =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'native-config'
  | 'dependency-upgrade';

export interface DefinitionOfDone {
  taskType: WorkItemType;
  requiredChecks: string[];
  requiredEvidence: string[];
  requiresHumanReview: boolean;
}
```

### Rule đề xuất

```yaml
bugfix:
  requiredEvidence:
    - root_cause_identified
    - fix_implemented
    - regression_test_or_explanation
    - related_checks_passed

feature:
  requiredEvidence:
    - behavior_implemented
    - edge_cases_handled
    - tests_added_or_explained
    - docs_updated_if_needed

refactor:
  requiredEvidence:
    - behavior_unchanged
    - public_api_compatibility_checked
    - tests_passed
    - blast_radius_reviewed

native-config:
  requiredEvidence:
    - ios_config_checked
    - android_config_checked
    - build_attempted_or_explained
    - rollback_path_available
```

### Tasks triển khai

- [ ] Tạo `DefinitionOfDoneRegistry`.
- [ ] Map task type sang DoD tương ứng.
- [ ] Planner phải chọn task type.
- [ ] Reviewer phải kiểm tra DoD trước khi pass.
- [ ] Nếu thiếu evidence, task không được mark done.

### Acceptance Criteria

- Task không thể pass nếu thiếu evidence bắt buộc.
- Dev nhìn dashboard biết task pass vì lý do gì.
- PR summary có phần Definition of Done.

---

## 4.4. Evidence Checklist

### Mục tiêu

Mỗi task phải có bằng chứng cụ thể: file đã sửa, check đã chạy, test đã pass, lỗi đã xử lý, lý do skip nếu có.

### Type đề xuất

```ts
export type EvidenceStatus = 'pending' | 'passed' | 'failed' | 'skipped';

export interface EvidenceItem {
  id: string;
  title: string;
  description?: string;
  status: EvidenceStatus;
  source?: 'command' | 'review' | 'diff' | 'human' | 'ai';
  command?: string;
  outputRef?: string;
  fileRefs?: string[];
  reason?: string;
}

export interface EvidenceReport {
  workItemId: string;
  taskGraphId: string;
  items: EvidenceItem[];
  finalVerdict: 'pass' | 'fail' | 'needs_human';
}
```

### Ví dụ Evidence Checklist cho React Native

```txt
- pnpm typecheck pass
- pnpm lint pass
- Metro import resolution không lỗi
- Không thêm package native nếu chưa được approve
- Nếu sửa iOS: đã check Podfile/Info.plist
- Nếu sửa Android: đã check Gradle/AndroidManifest
- Nếu sửa permission: update cả iOS và Android
- Có summary diff
- Có rollback patch
```

### Tasks triển khai

- [ ] Tạo `EvidenceCollector`.
- [ ] Tự tạo evidence từ command result.
- [ ] Tự tạo evidence từ diff analysis.
- [ ] Cho phép reviewer thêm evidence.
- [ ] Cho phép human override evidence trong dashboard.
- [ ] Xuất evidence vào PR body.

### Acceptance Criteria

- Mọi task done đều có evidence report.
- Evidence report link tới command output và file diff.
- Nếu check bị skip, bắt buộc có lý do.

---

## 4.5. React Native Project Adapter

### Mục tiêu

Orchestra cần hiểu sâu project React Native, đặc biệt với monorepo, pnpm, iOS/Android native build.

### Adapter cần detect

```txt
- React Native version
- Hermes enabled/disabled
- New Architecture enabled/disabled
- Package manager: pnpm/yarn/npm/bun
- Workspace root
- Metro config
- Babel config
- TypeScript path alias
- iOS Podfile
- Android Gradle config
- Native modules
- CodePush/OTA setup
- Firebase setup
- Permission setup
- Reanimated setup
```

### Type đề xuất

```ts
export interface ReactNativeProjectInfo {
  rnVersion?: string;
  packageManager: 'pnpm' | 'yarn' | 'npm' | 'bun' | 'unknown';
  workspaceRoot: string;
  appRoot: string;
  iosPath?: string;
  androidPath?: string;
  hasHermes?: boolean;
  hasNewArchitecture?: boolean;
  hasCodePush?: boolean;
  hasFirebase?: boolean;
  hasReanimated?: boolean;
  metroConfigPath?: string;
  babelConfigPath?: string;
  tsconfigPath?: string;
  podfilePath?: string;
  androidManifestPaths: string[];
  gradleFiles: string[];
}
```

### Tasks triển khai

- [ ] Tạo `ReactNativeProjectAdapter`.
- [ ] Detect RN version từ `package.json`.
- [ ] Detect monorepo root từ `pnpm-workspace.yaml`, `workspaces`, `.yarnrc.yml`.
- [ ] Parse Metro config để lấy watchFolders/resolver.
- [ ] Parse Babel config để detect decorators/reanimated.
- [ ] Parse Podfile để detect native setup.
- [ ] Parse Android Gradle để detect SDK/NDK/Hermes.
- [ ] Inject adapter context vào planner/fixer.

### Acceptance Criteria

- Khi chạy trong RN repo, Orchestra in ra project summary đúng.
- Khi task đụng native, risk tự tăng lên medium/high.
- AI biết khi nào cần `pod install`, Gradle build, Metro check.

---

## 4.6. Build Log Parser

### Mục tiêu

AI không nên nhận log thô quá dài. Orchestra cần parse log thành lỗi có cấu trúc để fixer xử lý chính xác.

### Type đề xuất

```ts
export type BuildTool =
  | 'tsc'
  | 'eslint'
  | 'jest'
  | 'metro'
  | 'xcodebuild'
  | 'gradle'
  | 'pod'
  | 'unknown';

export interface ParsedBuildError {
  tool: BuildTool;
  category: string;
  severity: 'error' | 'warning';
  file?: string;
  line?: number;
  column?: number;
  message: string;
  rawExcerpt: string;
  likelyCauses: string[];
  suggestedChecks: string[];
}

export interface ParsedBuildResult {
  tool: BuildTool;
  success: boolean;
  errors: ParsedBuildError[];
  warnings: ParsedBuildError[];
  rawLogRef: string;
}
```

### Parser cần có

```txt
TypeScriptLogParser
ESLintLogParser
JestLogParser
MetroLogParser
PodInstallLogParser
XcodeBuildLogParser
GradleBuildLogParser
```

### Lỗi React Native nên nhận diện

```txt
Metro:
- Unable to resolve module
- Duplicate module provider
- Babel plugin error
- Reanimated plugin order
- pnpm symlink resolution issue

Xcode:
- Missing header
- Undefined symbol
- Duplicate symbol
- Swift bridging header error
- Pod modulemap error
- Firebase modular headers issue
- Signing/provisioning issue

Gradle:
- Dependency resolution failed
- AAPT resource linking failed
- Kotlin compile error
- NDK source.properties issue
- Java heap space
- Manifest merger failed
- 16KB page size/native lib issue
```

### Tasks triển khai

- [ ] Tạo interface `BuildLogParser`.
- [ ] Implement parser cho `tsc`, `eslint`, `jest` trước.
- [ ] Implement parser cho `metro`.
- [ ] Implement parser cho `gradle`.
- [ ] Implement parser cho `xcodebuild`.
- [ ] Fixer nhận `ParsedBuildResult` thay vì raw log.
- [ ] Dashboard hiển thị lỗi đã phân loại.

### Acceptance Criteria

- Từ log lỗi, hệ thống lấy được file/line/category.
- Fixer prompt có lỗi ngắn gọn, không phải toàn bộ log.
- Dashboard hiển thị nguyên nhân khả dĩ và suggested checks.

---

## 4.7. Plan Approval

### Mục tiêu

Dev cần approve ở cấp kế hoạch trước khi AI sửa code, đặc biệt với thay đổi rủi ro cao.

### Plan nên có

```ts
export interface ExecutionPlan {
  id: string;
  workItemId: string;
  summary: string;
  filesToInspect: string[];
  filesToModify: string[];
  packagesToAdd: PackageChange[];
  commandsToRun: string[];
  risks: RiskAssessment[];
  requiresApproval: boolean;
}
```

### Ví dụ UI/CLI

```txt
Task: Add Google Login

AI proposes:
- Modify src/auth/auth.service.ts
- Modify src/screens/LoginScreen.tsx
- Add @react-native-google-signin/google-signin
- Modify Info.plist
- Modify android/app/build.gradle

Risk: HIGH
Reason: native config and new package

Actions:
[Approve plan] [Edit scope] [Reject]
```

### Tasks triển khai

- [ ] Planner xuất `ExecutionPlan` có cấu trúc.
- [ ] Risk policy đánh dấu plan cần approval hay không.
- [ ] CLI có mode approve/reject/edit.
- [ ] Dashboard có Plan Review View.
- [ ] Không implement nếu plan high-risk chưa được approve.

### Acceptance Criteria

- Thay đổi native/package/env luôn cần approval.
- Dev có thể sửa scope trước khi AI code.
- Plan đã approve được lưu vào audit log.

---

## 4.8. Change Impact / Blast Radius

### Mục tiêu

Khi AI sửa file, hệ thống phải biết module nào bị ảnh hưởng và cần chạy check nào.

### Flow

```txt
Changed files
    ↓
Import graph / dependency graph
    ↓
Affected modules
    ↓
Related tests
    ↓
Required verification commands
```

### Type đề xuất

```ts
export interface BlastRadiusReport {
  changedFiles: string[];
  affectedFiles: string[];
  affectedModules: string[];
  relatedTests: string[];
  riskLevel: RiskLevel;
  requiredChecks: string[];
}
```

### Tasks triển khai

- [ ] Hoàn thiện dependency graph cho TS/JS import.
- [ ] Map changed file sang related tests.
- [ ] Tính affected modules.
- [ ] Tự chọn scoped verification.
- [ ] Reviewer kiểm tra thay đổi có vượt scope không.

### Acceptance Criteria

- Sửa file core tự tăng risk vì ảnh hưởng nhiều module.
- Sửa test file risk thấp.
- Sửa native config risk cao.
- Verification command được chọn dựa trên blast radius.

---

## 4.9. Test Generation + Test Repair

### Mục tiêu

AI phải tự thêm hoặc cập nhật test khi cần, không chỉ sửa code.

### Mode cần có

```txt
1. Existing test mode
   Chạy test liên quan đến file sửa.

2. Missing test mode
   Nếu không có test, AI đề xuất test mới.

3. Behavioral verification mode
   Nếu khó viết test, AI tạo manual verification checklist.
```

### Tasks triển khai

- [ ] Tạo `TestDiscovery` tìm test liên quan.
- [ ] Tạo `TestGenerationPlanner`.
- [ ] Cho phép AI thêm test nếu risk thấp/medium.
- [ ] Nếu không thêm test, bắt buộc có lý do.
- [ ] Reviewer kiểm tra test có meaningful không.

### Acceptance Criteria

- Bugfix phải có regression test hoặc lý do không có.
- Feature phải có test hoặc manual verification checklist.
- AI không được xóa test để làm pass nếu không có approval.

---

## 4.10. GitHub Issue → Branch → PR → CI Watch → Auto Repair

### Mục tiêu

Đây là mốc chính để dev chỉ giám sát.

### Flow

```txt
GitHub Issue có label ai-ready
        ↓
Import issue thành Work Item
        ↓
Create branch/worktree
        ↓
AI implement
        ↓
Commit
        ↓
Open draft PR
        ↓
Watch CI
        ↓
Nếu CI fail → parse log → fix → push lại
        ↓
Nếu CI green → request human review
```

### Type đề xuất

```ts
export interface GitHubWorkItemSource {
  owner: string;
  repo: string;
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
}

export interface PullRequestState {
  branch: string;
  prNumber?: number;
  url?: string;
  ciStatus: 'pending' | 'success' | 'failure' | 'unknown';
  repairAttempts: number;
  maxRepairAttempts: number;
}
```

### Tasks triển khai

- [ ] Import issue bằng GitHub CLI hoặc API.
- [ ] Tạo work item từ issue.
- [ ] Tạo branch/worktree riêng.
- [ ] Commit theo từng logical change.
- [ ] Open draft PR.
- [ ] Poll CI status.
- [ ] Khi CI fail, fetch log.
- [ ] Parse CI log bằng Build Log Parser.
- [ ] Fix và push lại, giới hạn số lần retry.
- [ ] Nếu green, request human review.

### Acceptance Criteria

- Gán label `ai-ready` là Orchestra có thể xử lý issue.
- PR body có plan, evidence, checks, risk, summary.
- CI fail được tự sửa trong giới hạn retry.
- Nếu không tự sửa được, dashboard báo cần human.

---

## 4.11. Worktree per Task

### Mục tiêu

Mỗi task chạy trong worktree/branch riêng để không phá working tree hiện tại và có thể chạy song song.

### Cấu trúc đề xuất

```txt
repo/
worktrees/
  issue-123/
  issue-124/
  hotfix-login/
```

### Mỗi worktree cần có

```txt
- Branch riêng
- Artifact riêng
- Command log riêng
- Checkpoint riêng
- Evidence report riêng
- PR state riêng
```

### Tasks triển khai

- [ ] Hoàn thiện `WorktreeManager`.
- [ ] Tạo naming convention cho branch/worktree.
- [ ] Cleanup worktree sau khi merge/close.
- [ ] Dashboard hiển thị worktree active.
- [ ] Lock file để tránh 2 job sửa cùng branch.

### Acceptance Criteria

- Nhiều task có thể chạy song song an toàn.
- Main working tree không bị dirty khi AI chạy.
- Có thể cleanup/revert từng worktree.

---

## 4.12. AI Reviewer nhiều lớp

### Mục tiêu

Reviewer không chỉ review text. Reviewer phải kiểm tra scope, architecture, security, tests, diff và policy.

### Các lớp review

```txt
1. Static reviewer
   Kiểm tra rule cứng: secret, env, package, permission, native config.

2. Architecture reviewer
   Kiểm tra có phá pattern dự án không.

3. Security reviewer
   Kiểm tra token, auth, API, logging sensitive data.

4. Test reviewer
   Kiểm tra có test/verification phù hợp không.

5. Diff reviewer
   Kiểm tra thay đổi có đúng scope không.
```

### Type đề xuất

```ts
export interface ReviewIssue {
  severity: 'blocker' | 'warning' | 'info';
  category: string;
  message: string;
  file?: string;
  line?: number;
  suggestedFix?: string;
}

export interface ReviewResult {
  verdict: 'pass' | 'needs_fix' | 'needs_human';
  blockers: ReviewIssue[];
  warnings: ReviewIssue[];
  requiredFixPrompt?: string;
}
```

### Reviewer cần bắt được

```txt
- AI tự thêm package lạ
- AI sửa file ngoài scope
- AI hardcode API key
- AI đổi public API mà không update caller
- AI thêm permission native không giải thích
- AI xóa code/test để làm pass
- AI bỏ qua lỗi type bằng any quá nhiều
- AI sửa lockfile không cần thiết
```

### Tasks triển khai

- [ ] Tách reviewer thành nhiều reviewer nhỏ.
- [ ] Mỗi reviewer trả về structured result.
- [ ] Tổng hợp verdict cuối.
- [ ] Nếu `needs_fix`, tạo prompt cho fixer.
- [ ] Nếu `needs_human`, dừng và báo dashboard.

### Acceptance Criteria

- PR không được tạo nếu có blocker.
- Reviewer phát hiện scope creep.
- Reviewer bắt được secret/hardcoded token.

---

## 4.13. Policy Engine

### Mục tiêu

Quy định rõ AI được tự làm gì, cần hỏi gì, và bị cấm làm gì.

### Config đề xuất

```json
{
  "modes": {
    "observe": "chỉ phân tích, không sửa",
    "suggest": "tạo patch, không apply",
    "supervised": "apply low-risk, hỏi high-risk",
    "autopilot": "tự apply + PR, hỏi khi policy yêu cầu"
  },
  "rules": [
    {
      "match": ["ios/**", "android/**", "Podfile", "build.gradle"],
      "risk": "high",
      "requiresApproval": true
    },
    {
      "match": [".env*", "**/secrets/**"],
      "action": "deny"
    },
    {
      "match": ["package.json", "pnpm-lock.yaml"],
      "risk": "medium",
      "requiresApproval": true
    },
    {
      "match": ["src/**/*.test.ts", "src/**/*.test.tsx"],
      "risk": "low",
      "autoApply": true
    }
  ]
}
```

### Tasks triển khai

- [ ] Tạo `PolicyEngine` đọc rule từ project profile.
- [ ] Evaluate plan trước khi implement.
- [ ] Evaluate diff trước khi apply.
- [ ] Evaluate package changes.
- [ ] Evaluate PR trước khi push.
- [ ] Ghi audit log cho mọi override.

### Acceptance Criteria

- File nhạy cảm bị block.
- Thay đổi native/package luôn cần approval.
- Autopilot không vượt policy.

---

## 4.14. Package Change Guard

### Mục tiêu

AI không được tự thêm dependency bừa bãi, đặc biệt trong React Native vì có ảnh hưởng native.

### Package change report

```ts
export interface PackageChange {
  packageName: string;
  version?: string;
  changeType: 'add' | 'remove' | 'upgrade' | 'downgrade';
  reason: string;
  hasNativeImpact?: boolean;
  requiresPodInstall?: boolean;
  requiresGradleSync?: boolean;
  riskLevel: RiskLevel;
}
```

### Rule

```txt
Nếu package.json hoặc lockfile thay đổi:
- AI phải giải thích vì sao cần package.
- So sánh với package đã có.
- Kiểm tra package có native module không.
- Kiểm tra iOS/Android impact.
- Kiểm tra license nếu cần.
- Bắt buộc human approval nếu là native package.
```

### Tasks triển khai

- [ ] Diff package.json trước/sau.
- [ ] Detect package add/remove/upgrade.
- [ ] Detect native impact bằng keyword/package metadata nếu có.
- [ ] Tạo package change report.
- [ ] Block auto-apply nếu chưa approve.

### Acceptance Criteria

- AI không thể tự thêm native package trong autopilot nếu chưa approve.
- PR body giải thích mọi dependency change.

---

## 4.15. Secret / Sensitive Data Scanner

### Mục tiêu

Trước khi commit/PR, phải scan secret và dữ liệu nhạy cảm.

### Cần scan

```txt
- API key
- token
- private key
- .env
- Firebase plist/json
- keystore
- provisioning profile
- hardcoded bearer token
- password/secret trong code
```

### Tasks triển khai

- [ ] Tích hợp scanner đơn giản bằng regex trước.
- [ ] Hỗ trợ custom pattern trong project profile.
- [ ] Scan diff trước khi commit.
- [ ] Block PR nếu có secret.
- [ ] Cho phép false-positive override có audit log.

### Acceptance Criteria

- Secret bị phát hiện thì task cần human.
- Không push PR nếu có blocker secret.

---

## 4.16. Rollback / Revert Plan

### Mục tiêu

Mọi AI run phải dễ rollback.

### Mỗi run cần lưu

```txt
- Files before
- Files after
- Patch
- Commands run
- Command results
- Evidence report
- Checkpoint id
```

### CLI đề xuất

```bash
orchestra runs list
orchestra runs show <runId>
orchestra runs revert <runId>
orchestra work revert <workItemId>
```

### Tasks triển khai

- [ ] Lưu patch trước/sau mỗi apply.
- [ ] Tạo checkpoint trước khi sửa.
- [ ] Implement revert run.
- [ ] Implement revert work item.
- [ ] Dashboard có nút rollback.

### Acceptance Criteria

- Có thể quay lại trạng thái trước khi AI sửa.
- Rollback không làm mất audit log.

---

## 4.17. Repository Memory / Lesson Memory

### Mục tiêu

Orchestra phải nhớ các lỗi và giải pháp từng xảy ra trong repo để lần sau xử lý nhanh hơn.

### Type đề xuất

```ts
export interface RepoLesson {
  id: string;
  repoId: string;
  trigger: string[];
  problem: string;
  solution: string;
  confidence: number;
  sourceRunId?: string;
  lastUsedAt?: string;
  createdAt: string;
}
```

### Ví dụ memory hữu ích cho React Native

```txt
Lesson:
- Repo dùng pnpm, Metro phải resolve từ root node_modules.
- Không dùng w-full trong ListVideoStreaming vì gây nhảy layout.
- RN 0.81 + pnpm dễ lỗi ReactCommon headers trên iOS.
- Firebase cần modular_headers cho GoogleUtilities trong Podfile.
- CodePush release-react có thể lỗi với pnpm .bin shim.
```

### Tasks triển khai

- [ ] Sau mỗi run thành công, cho reviewer đề xuất lesson.
- [ ] Human approve lesson trước khi lưu.
- [ ] Khi lỗi mới xảy ra, search lesson theo trigger.
- [ ] Inject lesson liên quan vào fixer prompt.
- [ ] Dashboard quản lý repo lessons.

### Acceptance Criteria

- Lỗi lặp lại được gợi ý solution cũ.
- Memory có confidence và source run.
- Human có thể sửa/xóa lesson.

---

## 4.18. Dashboard — AI Dev Control Room

### Mục tiêu

Dev không đọc log thô. Dev giám sát qua dashboard.

### Màn hình cần có

#### 1. Plan Review View

```txt
- AI định sửa gì
- Vì sao sửa
- File nào bị ảnh hưởng
- Risk
- Commands sẽ chạy
- Approval buttons
```

#### 2. Live Execution Timeline

```txt
[Inspect repo] done
[Plan] done
[Generate patch] running
[Typecheck] failed
[Fix type error] running
[Review] pending
[PR] pending
```

#### 3. Diff Review View

```txt
File: src/auth/login.ts
Reason: add retry logic
Risk: low
Related tests: auth.test.ts
```

#### 4. CI Failure View

```txt
CI failed:
- Android build failed
- Category: Manifest merger
- Likely cause: missing permission declaration
- AI proposed fix: update AndroidManifest.xml
```

#### 5. Human Inbox

```txt
Needs your decision:
- Approve native package install?
- Approve change to Podfile?
- Merge PR?
- Accept skipped test reason?
```

### Tasks triển khai

- [ ] Tạo Plan Review page.
- [ ] Tạo Execution Timeline page.
- [ ] Tạo Human Inbox page.
- [ ] Tạo Evidence Report page.
- [ ] Tạo CI Failure page.
- [ ] Tạo Rollback action.

### Acceptance Criteria

- Dev biết task đang ở bước nào.
- Dev chỉ cần xử lý các decision quan trọng.
- Không cần đọc raw log trừ khi muốn debug sâu.

---

## 4.19. MCP Tool Registry

### Mục tiêu

Orchestra cần có hệ thống tool mở rộng được, sau này kết nối GitHub, Jira/Linear, filesystem, database, browser automation, test runner.

### Vai trò đề xuất

```txt
Orchestra as MCP Client:
- gọi GitHub MCP
- gọi filesystem MCP
- gọi database MCP
- gọi Linear/Jira MCP
- gọi browser/test runner MCP

Orchestra as MCP Server:
- expose runs
- expose artifacts
- expose work items
- expose repo intelligence
- expose evidence reports
```

### Tasks triển khai

- [ ] Thiết kế `ToolRegistry` độc lập provider.
- [ ] Chuẩn hóa tool schema.
- [ ] Thêm MCP client adapter.
- [ ] Thêm MCP server adapter sau.
- [ ] Policy engine kiểm soát tool permissions.

### Acceptance Criteria

- Tool mới có thể đăng ký mà không sửa core nhiều.
- Mỗi tool có permission/risk riêng.
- Planner biết tool nào được phép dùng.

---

## 4.20. Internal Benchmark / Analytics

### Mục tiêu

Cần đo xem AI có thực sự hiệu quả không, provider nào tốt nhất cho từng role.

### Metrics cần có

```txt
- Task success rate
- Số vòng fix trung bình
- Lỗi thường gặp
- Provider nào làm tốt role nào
- Chi phí/token/time
- Tỷ lệ human phải can thiệp
- Tỷ lệ PR bị reject
- Tỷ lệ CI fail sau khi AI báo done
```

### Tasks triển khai

- [ ] Lưu metrics theo run.
- [ ] Lưu metrics theo provider/role.
- [ ] Lưu metrics theo task type.
- [ ] Dashboard analytics.
- [ ] Routing provider dựa trên dữ liệu lịch sử.

### Acceptance Criteria

- Biết provider nào phù hợp planner/generator/reviewer/fixer.
- Biết loại task nào AI hay fail.
- Biết bottleneck nằm ở đâu.

---

# 5. Roadmap triển khai theo phase

## Phase 1 — Local AI Dev Assistant đáng tin

### Mục tiêu

Dùng được hằng ngày cho task nhỏ/vừa trong repo local.

### Việc cần làm

```txt
1. Project Profile .orchestra/project.yaml
2. Definition of Done theo task type
3. Evidence Checklist
4. React Native Project Adapter
5. Build Log Parser cho tsc/eslint/jest/metro
6. Plan Approval CLI/UI
7. Package Change Guard
8. Secret Scanner
9. Rollback Command
```

### Kết quả kỳ vọng

```txt
- AI sửa bug UI/service tốt hơn.
- AI chạy check có bằng chứng.
- AI không tự ý sửa native/package/env.
- Dev review ít hơn vì có evidence rõ.
```

---

## Phase 2 — AI Worker xử lý GitHub Issue

### Mục tiêu

Dev giao issue, AI tự tạo branch/PR.

### Việc cần làm

```txt
1. Task Graph thật
2. Worktree per Task ổn định
3. GitHub Issue Import
4. Branch/Commit/PR Automation
5. CI Watch
6. CI Log Parser
7. CI Auto Repair Loop
8. PR Summary + Evidence Report
```

### Kết quả kỳ vọng

```txt
- Gán issue label ai-ready.
- AI tạo branch/worktree.
- AI implement.
- AI mở PR.
- AI theo dõi CI.
- Dev review/merge.
```

---

## Phase 3 — Team AI Engineering Platform

### Mục tiêu

Nhiều dev, nhiều repo, nhiều agent, quản lý qua dashboard.

### Việc cần làm

```txt
1. Multi-project Registry
2. RBAC / Team Permission
3. GitHub/GitLab Webhooks
4. MCP Tool Registry
5. Plugin Marketplace nội bộ
6. Cost Budget per Repo/User
7. Audit/Compliance Report
8. Provider Benchmark và Auto Routing
```

### Kết quả kỳ vọng

```txt
- Dùng được cho team.
- Có kiểm soát quyền.
- Có dashboard giám sát nhiều repo.
- Có báo cáo chi phí/chất lượng.
```

---

# 6. Thứ tự ưu tiên đề xuất

Nếu triển khai ngay, nên làm theo thứ tự sau:

```txt
1. .orchestra/project.yaml
2. Definition of Done
3. Evidence Checklist
4. Policy Engine nâng cấp
5. React Native Project Adapter
6. Build Log Parser
7. Plan Approval
8. Package Change Guard
9. Secret Scanner
10. Rollback Command
11. Task Graph thật
12. Worktree per Task
13. GitHub Issue → Work Item → Branch → PR
14. CI Watch → Auto Repair
15. Dashboard Human Inbox
16. Repository Lesson Memory
17. MCP Tool Registry
18. Analytics/Benchmark
```

---

# 7. Prompt mẫu cho Codex triển khai Phase 1

```txt
Bạn đang làm việc trong repo Orchestra-AI-Platform.

Mục tiêu: triển khai Phase 1 để biến Orchestra thành local AI dev assistant đáng tin.

Hãy làm theo thứ tự:

1. Thêm Project Profile:
   - Tạo schema cho .orchestra/project.yaml
   - Tạo loader đọc config từ repo root
   - Validate bằng Zod hoặc schema hiện có
   - Expose project profile cho planner/reviewer/fixer

2. Thêm Definition of Done:
   - Tạo registry theo task type: bugfix, feature, refactor, test, docs, native-config, dependency-upgrade
   - Mỗi task type có requiredEvidence và requiredChecks
   - Reviewer phải kiểm tra DoD trước khi pass

3. Thêm Evidence Checklist:
   - Tạo EvidenceItem, EvidenceReport
   - Collect evidence từ command result, diff analysis, review result
   - Nếu check bị skip thì bắt buộc có reason
   - Xuất evidence vào run summary

4. Nâng cấp Policy Engine:
   - Hỗ trợ noTouch, requireApproval từ project profile
   - Block file nhạy cảm
   - Bắt approval nếu sửa package/native/env

5. Thêm React Native Project Adapter:
   - Detect RN version, package manager, workspace root, iOS path, Android path
   - Detect Metro/Babel/TS config
   - Detect Podfile/Gradle/AndroidManifest
   - Tạo ReactNativeProjectInfo và inject vào planner/fixer

6. Thêm Build Log Parser cơ bản:
   - tsc
   - eslint
   - jest
   - metro
   - Output ParsedBuildResult có category/file/line/message/likelyCauses

7. Thêm Package Change Guard:
   - Detect package.json và lockfile diff
   - Tạo PackageChange report
   - Require approval nếu thêm/sửa package native hoặc lockfile

8. Thêm Secret Scanner:
   - Scan diff trước commit/apply
   - Detect API key/token/private key/.env/Firebase plist/json/keystore
   - Nếu phát hiện thì block và yêu cầu human

9. Thêm Rollback Command:
   - Lưu patch trước/sau apply
   - Có command revert theo runId

Yêu cầu kỹ thuật:
- Không phá API hiện có.
- Có type rõ ràng.
- Có unit test cho logic quan trọng.
- Nếu chưa biết cấu trúc repo, inspect trước rồi mới sửa.
- Mỗi bước phải có summary và file list.
- Không tự ý thêm dependency nếu không cần.
```

---

# 8. Prompt mẫu cho Codex triển khai Phase 2

```txt
Bạn đang làm việc trong repo Orchestra-AI-Platform.

Mục tiêu: triển khai Phase 2 để AI có thể xử lý GitHub issue thành PR.

Hãy làm theo thứ tự:

1. Task Graph:
   - Tạo TaskGraph, TaskNode, TaskGraphExecutor
   - Node có dependency, status, attempts, maxAttempts, requiredEvidence
   - Có thể resume từ node fail

2. Worktree per Task:
   - Tạo worktree/branch riêng cho mỗi work item
   - Lưu state, artifact, evidence theo worktree
   - Có cleanup command

3. GitHub Issue Import:
   - Import issue bằng gh CLI hoặc GitHub API abstraction
   - Convert issue thành WorkItem
   - Support label ai-ready

4. Branch/Commit/PR Automation:
   - Tạo branch theo issue
   - Commit logical changes
   - Tạo draft PR
   - PR body gồm plan, evidence, checks, risks, summary

5. CI Watch:
   - Poll PR checks
   - Fetch CI logs nếu fail
   - Parse log bằng BuildLogParser

6. CI Auto Repair:
   - Nếu CI fail, tạo fix task node
   - Giới hạn retry
   - Push lại sau mỗi fix
   - Nếu không fix được, mark needs_human

Yêu cầu:
- Không chạy auto-repair vô hạn.
- Mọi push/PR phải có audit log.
- Nếu policy yêu cầu approval thì dừng.
- Dashboard/API phải thấy trạng thái work item, task graph, PR, CI.
```

---

# 9. Prompt mẫu cho Codex triển khai Dashboard nâng cấp

```txt
Bạn đang làm việc trong repo Orchestra-AI-Platform.

Mục tiêu: nâng cấp dashboard thành AI Dev Control Room.

Cần thêm các màn:

1. Plan Review View:
   - Hiển thị filesToInspect, filesToModify, packagesToAdd, commandsToRun, risks
   - Có nút Approve, Reject, Edit Scope

2. Execution Timeline:
   - Hiển thị task graph theo node
   - Mỗi node có status, duration, attempts, evidence

3. Human Inbox:
   - Gom các decision cần dev xử lý
   - Approve package change
   - Approve native config
   - Accept skipped test reason
   - Request rerun/retry

4. Evidence Report View:
   - Hiển thị required evidence và status
   - Link tới command output/diff

5. CI Failure View:
   - Hiển thị parsed CI error
   - Category, file, line, likely causes, suggested fix
   - Nút approve auto-fix nếu risk cao

6. Rollback Action:
   - Cho phép revert run/work item từ UI

Yêu cầu:
- Không cần UI quá phức tạp.
- Ưu tiên rõ trạng thái và quyết định cần human.
- Tách component để dễ maintain.
```

---

# 10. Checklist cuối cùng trước khi gọi là “Dev chỉ giám sát”

Một task chỉ được coi là hoàn chỉnh khi:

```txt
[ ] Có task graph hoặc plan rõ ràng
[ ] Có risk assessment
[ ] Có approval nếu đụng file/package/native/env rủi ro cao
[ ] Có worktree/branch riêng
[ ] Có diff summary
[ ] Có evidence checklist
[ ] Có check command result
[ ] Có parsed error nếu check fail
[ ] Có self-repair loop giới hạn
[ ] Có AI reviewer pass
[ ] Có secret scanner pass
[ ] Có package guard pass
[ ] Có rollback patch
[ ] Có PR summary nếu tạo PR
[ ] Có CI status nếu chạy qua GitHub
[ ] Nếu còn vấn đề, dashboard báo needs_human rõ ràng
```

---

## 11. Kết luận

Các phần quan trọng nhất cần làm không phải là thêm model mới, mà là thêm **quy trình kỹ thuật** để AI code an toàn và có thể kiểm chứng:

```txt
Task Graph thật
+ Evidence Checklist
+ Definition of Done
+ Project-specific Adapter
+ Build/CI Log Parser
+ Policy Engine
+ GitHub PR Auto Repair
+ Dashboard Human Inbox
```

Khi các phần này đủ tốt, Orchestra có thể đạt mục tiêu thực tế:

> Dev giao issue/task, AI tự code và tự sửa lỗi, dev chỉ approve những điểm rủi ro cao và review PR cuối.
