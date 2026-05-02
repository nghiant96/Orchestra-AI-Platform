Đúng, vậy thì hướng của bạn **rõ hơn và hay hơn**: không phải “Orchestra cạnh tranh với Codex/Claude/Gemini”, mà là:

> **Orchestra = AI Software Workspace / Autonomous Work Executor**
> Một hệ thống nhận một công việc, tự hiểu mức độ phức tạp, tự chia nhỏ, lập checklist, lập plan, tạo branch, thực hiện từng bước, chạy check, tự sửa lỗi, rồi mở PR có báo cáo đầy đủ.

Nói cách khác, **model/agent chỉ là worker**. Sản phẩm chính của bạn là **workflow engine + workspace + governance layer** cho công việc phát triển phần mềm.

Repo hiện tại đã có nền khá gần với hướng này: README đã có `ai implement`, `ai fix`, `ai fix-checks`, vòng `plan -> implement -> checks -> auto-fix`, artifact-backed runs, review-only workflow, resume/retry, TUI/dashboard, tool checks và context expansion. ([GitHub][1]) Release notes cũng đã có Task Contracts, risk scoring, policy-based automation, dashboard, multi-project registry, roles, audit log, isolation và lessons system. ([GitHub][2])

## Định vị mới nên là gì?

Mình sẽ đổi định vị từ:

> “AI coding system that uses installed AI CLIs”

thành:

> **AI Software Workspace that turns engineering tasks into planned, checked, branch-based pull requests.**

Hoặc ngắn hơn:

> **From task to checked PR, automatically.**

Điểm khác biệt chính không phải “AI viết code giỏi hơn”, mà là:

**Người dùng đưa vào một task → hệ thống tự vận hành toàn bộ lifecycle.**

Lifecycle đó gồm:

```text
Task intake
  -> task assessment
  -> decomposition
  -> checklist
  -> execution plan
  -> workspace/branch creation
  -> implementation
  -> checks
  -> auto-fix loop
  -> self-review
  -> PR creation
  -> CI feedback loop
  -> final report
  -> learning/memory
```

Đây là hướng rất đúng nếu bạn muốn tiến tới “workspace”.

## Hình thái sản phẩm nên hướng tới

Mình nghĩ sản phẩm nên có 3 lớp.

### 1. Work Executor

Đây là lõi hiện tại của Orchestra.

Nhiệm vụ của nó là nhận task và biến task thành các bước có thể chạy được.

Ví dụ user nhập:

> “Fix bug đăng nhập bằng Google, thỉnh thoảng redirect về `/login` dù đã auth thành công.”

Hệ thống nên tự tạo ra:

```yaml
workItem:
  type: bugfix
  risk: medium
  confidence: 0.72
  expectedOutput: pull_request
  branch: ai/fix-google-login-redirect

checklist:
  - Reproduce or inspect auth redirect flow
  - Locate OAuth callback/session handling
  - Identify race condition or missing session persistence
  - Add/adjust tests
  - Implement fix
  - Run targeted checks
  - Run full checks if auth/session touched
  - Generate PR summary

plan:
  - inspect files related to auth/session/router
  - run current tests
  - patch minimal files
  - run typecheck/lint/test
  - create PR
```

Đây khác với agent coding thông thường ở chỗ: **nó không nhảy vào sửa ngay**. Nó đánh giá, chia nhỏ, lập contract/checklist, rồi mới chạy.

Repo của bạn đã có “Task Contracts” để tracking requirement, automatic extraction và inject contract vào generator/reviewer/fixer, nên phần này nên được nâng thành trung tâm của hệ thống. ([GitHub][2])

### 2. Workspace Manager

Đây là phần “tiến tới workspace” mà bạn nói.

Workspace không chỉ là dashboard. Workspace nên là nơi quản lý:

```text
Projects
Tasks
Branches
Runs
Plans
Checklists
Artifacts
Reviews
PRs
CI status
Lessons
Team approvals
```

Hiện Operations docs đã có local HTTP service, dashboard, project registry, queue job API, approve/reject/cancel/resume/retry, stats, lessons và audit. ([GitHub][3]) Đây là nền rất tốt để nâng lên thành workspace thật.

Workspace nên trả lời được các câu hỏi:

* Task nào đang chạy?
* Task nào đang chờ approve?
* Task nào đã tạo branch?
* Task nào đã mở PR?
* PR nào fail CI?
* AI đã sửa lỗi mấy vòng?
* Checklist nào đã xong/chưa xong?
* Vì sao task này bị đánh giá high-risk?
* File nào bị sửa?
* Có test nào chứng minh fix đúng không?
* Có lesson nào được học từ task này không?

Tức là dashboard không chỉ “xem job”, mà trở thành **bảng điều khiển công việc phần mềm**.

### 3. Git/PR Automation Layer

Đây nên là bước tiến quan trọng tiếp theo.

Hiện GitHub PR workflow rất phù hợp với hướng này vì PR là cơ chế chuẩn để đề xuất thay đổi qua branch; GitHub docs cũng mô tả PR là thay đổi được đề xuất từ một branch để default branch chỉ chứa code đã hoàn tất/được duyệt. ([GitHub Docs][4]) GitHub CLI có `gh pr create`, `gh pr checks`, `gh pr review`, `gh pr merge`, nên giai đoạn đầu bạn có thể tích hợp bằng CLI trước khi làm GitHub App phức tạp. ([GitHub CLI][5]) GitHub REST API cũng hỗ trợ quản lý pull requests như list/view/edit/create/merge, hữu ích khi bạn muốn server/workspace điều khiển PR trực tiếp. ([GitHub Docs][6])

Flow nên như sau:

```text
1. User tạo task trong Orchestra workspace
2. Orchestra đánh giá task
3. Orchestra tạo execution plan
4. Nếu risk medium/high thì chờ approve plan
5. Orchestra tạo branch
6. Orchestra implement từng step
7. Orchestra chạy checks
8. Nếu fail thì tự tạo repair task nội bộ
9. Khi green thì tạo PR
10. PR body chứa:
    - task summary
    - checklist
    - files changed
    - checks run
    - risk assessment
    - known limitations
    - artifacts link
11. Nếu CI fail sau khi mở PR:
    - Orchestra đọc failure
    - tạo follow-up fix commit
    - push vào cùng branch
12. Khi review comments xuất hiện:
    - Orchestra phân loại comment
    - tự sửa comment đơn giản
    - hỏi người dùng với comment rủi ro cao
```

## Kiến trúc lõi nên đổi sang “Work Item State Machine”

Hiện bạn đã có queue, artifact-backed runs, approval, resume/retry. Nhưng để đi đúng hướng workspace, mình nghĩ nên formalize lại lõi thành **state machine cho một công việc**.

Ví dụ:

```text
CREATED
  -> ASSESSING
  -> DECOMPOSING
  -> PLANNING
  -> WAITING_PLAN_APPROVAL
  -> CREATING_WORKSPACE
  -> CREATING_BRANCH
  -> EXECUTING_STEP
  -> RUNNING_CHECKS
  -> FIXING_FAILURES
  -> REVIEWING
  -> WAITING_GENERATION_APPROVAL
  -> COMMITTING
  -> PUSHING_BRANCH
  -> CREATING_PR
  -> WATCHING_CI
  -> FIXING_CI_FAILURE
  -> READY_FOR_HUMAN_REVIEW
  -> DONE
  -> FAILED
  -> CANCELLED
```

Quan trọng là mỗi state phải có artifact:

```text
assessment.json
decomposition.json
plan.json
checklist.json
risk.json
selected-files.json
patches/
check-results.json
review.json
commits.json
pr.json
ci-results.json
final-report.md
```

Như vậy hệ thống sẽ rất dễ debug, replay, resume, audit và hiển thị trong workspace.

## Data model nên có

Mình sẽ thiết kế các object chính như sau.

### `WorkItem`

Đại diện cho công việc người dùng giao.

```ts
type WorkItem = {
  id: string;
  title: string;
  description: string;
  source: "manual" | "github_issue" | "slack" | "api" | "ci_failure";
  projectId: string;
  status: WorkStatus;
  type: "feature" | "bugfix" | "refactor" | "test" | "docs" | "investigation";
  risk: "low" | "medium" | "high" | "blocked";
  createdBy: Actor;
  expectedOutput: "patch" | "branch" | "pull_request" | "report";
};
```

### `TaskAssessment`

Đây là phần AI tự đánh giá mức độ công việc.

```ts
type TaskAssessment = {
  complexity: "small" | "medium" | "large";
  risk: "low" | "medium" | "high" | "blocked";
  confidence: number;
  estimatedSteps: number;
  affectedAreas: string[];
  requiresBranch: boolean;
  requiresHumanApproval: boolean;
  requiresFullTestSuite: boolean;
  reason: string;
};
```

Phần này nên kết hợp **deterministic rules + AI judgment**. Không nên để AI tự quyết hoàn toàn.

Ví dụ deterministic signals:

```text
Touch auth/payment/security/migration/deployment -> higher risk
Diff > N files -> higher risk
Package dependency change -> higher risk
Database migration -> approval required
Delete files -> approval required
Env/config/secrets -> blocked or manual approval
```

Repo hiện đã có risk scoring và policy-based automation theo paths, diff size và sensitivity; nên hướng đúng là mở rộng phần này thay vì viết lại. ([GitHub][2])

### `TaskBreakdown`

Đại diện cho việc chia nhỏ task.

```ts
type TaskBreakdown = {
  parentWorkItemId: string;
  tasks: SubTask[];
};

type SubTask = {
  id: string;
  title: string;
  goal: string;
  dependsOn: string[];
  status: "pending" | "running" | "done" | "failed" | "skipped";
  acceptanceCriteria: string[];
};
```

Ví dụ bugfix có thể tự chia thành:

```text
1. Investigate current behavior
2. Identify likely root cause
3. Add regression test
4. Implement minimal fix
5. Run targeted checks
6. Run full checks
7. Create PR
```

### `Checklist`

Checklist không nên chỉ là UI. Nó nên là **execution contract**.

```ts
type ChecklistItem = {
  id: string;
  text: string;
  required: boolean;
  status: "todo" | "doing" | "passed" | "failed" | "waived";
  evidence?: {
    type: "file" | "check" | "commit" | "review" | "artifact";
    ref: string;
  };
};
```

Một checklist item chỉ được mark “passed” khi có evidence.

Ví dụ:

```text
[x] Added regression test
    evidence: tests/auth/google-login.test.ts

[x] Typecheck passed
    evidence: check-results/typecheck.json

[x] PR created
    evidence: https://github.com/.../pull/123
```

Đây là phần sẽ làm Orchestra khác biệt: **AI không chỉ nói đã làm; nó phải gắn bằng chứng.**

## Flow bugfix nên là use case đầu tiên

Mình nghĩ bạn nên ưu tiên bugfix hơn feature lớn, vì bugfix có vòng đời rất hợp với automation:

```text
Bug report
  -> reproduce/inspect
  -> identify likely files
  -> create failing test if possible
  -> implement fix
  -> run checks
  -> create PR
  -> watch CI
  -> fix CI failure
```

Command tương lai có thể là:

```bash
ai work create "Fix Google login redirect bug" --type bugfix --pr
```

Hoặc từ GitHub Issue:

```bash
ai work from-issue 123 --pr
```

Hoặc từ CI failure:

```bash
ai fix-ci --pr 456
```

Hiện repo đã có `ai fix-checks`, tức là đọc failing checks rồi tạo structured repair task và chạy normal fix loop. ([GitHub][1]) Đây nên là một pillar lớn: **CI failure auto-repair**.

## PR body nên trở thành sản phẩm

PR tự động không nên chỉ có title/body sơ sài. PR body nên là báo cáo công việc.

Ví dụ template:

```md
## Summary

Fixes intermittent Google login redirect to `/login` after successful OAuth callback.

## Task Assessment

- Type: bugfix
- Risk: medium
- Complexity: medium
- Reason: touches auth/session redirect flow

## Plan

- [x] Inspect OAuth callback and session persistence
- [x] Add regression test for authenticated redirect
- [x] Patch redirect guard
- [x] Run targeted auth tests
- [x] Run typecheck/lint

## Files Changed

- `src/auth/callback.ts`
- `src/router/auth-guard.ts`
- `tests/auth/google-login.test.ts`

## Checks

- [x] `pnpm test tests/auth/google-login.test.ts`
- [x] `pnpm run typecheck`
- [x] `pnpm run lint`

## Review Notes

- No database migration
- No dependency changes
- No environment changes

## Artifacts

- Run ID: `run_...`
- Plan: `01-plan/plan.json`
- Checks: `iteration-1/checks.json`
- Review: `iteration-1/review.json`
```

Đây là thứ rất có giá trị cho team: người review PR không cần đoán AI đã làm gì.

## Roadmap theo hướng bạn muốn

### Phase 1 — Work Item Engine

Mục tiêu: biến task thường thành work item có assessment, breakdown, checklist và plan.

Nên làm:

* `WorkItem` model
* `TaskAssessment` model
* `TaskBreakdown` model
* `Checklist` model
* Artifact schema cho từng phần
* UI hiển thị assessment/checklist/plan rõ ràng
* Thêm command:

```bash
ai work assess "..."
ai work plan "..."
ai work run "..."
```

Kết quả phase này: AI không còn chỉ “implement task”, mà biết **đánh giá và tổ chức công việc**.

### Phase 2 — Branch Automation

Mục tiêu: mỗi work item có thể chạy trong branch riêng.

Nên thêm:

```bash
ai work run "Fix login bug" --branch
ai work run "Add export CSV" --branch ai/add-export-csv
```

Logic:

```text
- ensure clean working tree
- fetch latest base
- create branch from base
- run implementation
- commit changes
- keep artifact mapping between runId <-> branch <-> commit
```

Cần chính sách an toàn:

```text
Low risk    -> auto branch + commit
Medium risk -> approve plan before branch write
High risk   -> approve plan + approve generated diff
Blocked     -> no auto write
```

Operations docs hiện đã có approval policy low/medium/high/blocked; bạn nên reuse và mở rộng nó sang branch/commit/PR actions. ([GitHub][3])

### Phase 3 — PR Automation

Mục tiêu: từ work item tạo PR tự động.

Command:

```bash
ai work run "Fix login bug" --pr
ai pr create --from-run last
```

Có thể bắt đầu bằng `gh pr create`, vì GitHub CLI chính thức hỗ trợ làm việc với PR từ command line. ([GitHub CLI][5]) Sau này chuyển sang GitHub REST API hoặc GitHub App khi cần server-side/multi-user tốt hơn. GitHub REST API có endpoint quản lý pull request, bao gồm create và merge. ([GitHub Docs][6])

Nên lưu:

```json
{
  "pr": {
    "provider": "github",
    "owner": "nghiant96",
    "repo": "Orchestra-AI-Platform",
    "number": 123,
    "url": "...",
    "branch": "ai/fix-login-bug",
    "base": "main"
  }
}
```

### Phase 4 — CI Feedback Loop

Mục tiêu: PR fail CI thì Orchestra tự sửa.

Flow:

```text
PR opened
  -> wait/check CI status
  -> if failed:
      collect failing logs
      create internal fix task
      patch branch
      commit
      push
      repeat until green or budget exceeded
```

GitHub Actions đã có workflow triggers và PR-related workflow filters, nên hệ thống có thể dựa vào PR checks/CI để phản hồi. ([GitHub Docs][7]) Nếu chạy trong GitHub Actions, `GITHUB_TOKEN` có thể dùng để authenticate workflow automation, nhưng cần cấu hình permission đúng; GitHub cũng có setting cho phép GitHub Actions tạo và approve PR bằng `GITHUB_TOKEN`. ([GitHub Docs][8])

### Phase 5 — Workspace UI

Mục tiêu: biến dashboard thành workspace thật.

Các màn hình nên có:

```text
1. Inbox
   - task mới
   - GitHub issues
   - CI failures
   - manual requests

2. Work Board
   - To plan
   - Waiting approval
   - Running
   - PR opened
   - CI failed
   - Ready for review
   - Done

3. Work Item Detail
   - assessment
   - decomposition
   - checklist
   - plan
   - current state
   - branch
   - PR
   - files changed
   - check results
   - AI review
   - human approvals

4. PR Center
   - PRs opened by Orchestra
   - CI status
   - review comments
   - auto-fix attempts
   - merge readiness

5. Lessons / Memory
   - accepted lessons
   - proposed lessons
   - where each lesson was used
```

Lúc này Orchestra không chỉ là CLI nữa. Nó là **workspace điều phối công việc AI-assisted software development**.

## Tên module nên tách

Mình đề xuất cấu trúc domain như sau:

```text
ai-system/
  work/
    work-item.ts
    assessment.ts
    decomposition.ts
    checklist.ts
    planner.ts
    executor.ts
    state-machine.ts

  git/
    branch-manager.ts
    commit-manager.ts
    diff-manager.ts

  github/
    github-client.ts
    pr-manager.ts
    checks-client.ts
    issue-client.ts

  workspace/
    project-registry.ts
    work-board.ts
    notifications.ts

  policy/
    risk-engine.ts
    approval-policy.ts
    action-permissions.ts

  artifacts/
    artifact-store.ts
    schema-version.ts
```

Điểm quan trọng: **git/github/workspace không nên bị trộn vào generator/fixer**. Generator chỉ làm nhiệm vụ tạo patch. Work engine mới là thứ quyết định patch đó đi đâu.

## Một decision quan trọng: task graph thay vì linear plan

Nếu bạn muốn “chia thành nhiều việc nhỏ”, nên thiết kế sớm theo dạng graph.

Ví dụ:

```text
A. Inspect auth flow
B. Inspect route guard
C. Add regression test
D. Implement fix
E. Run checks
F. Create PR

C depends on A,B
D depends on A,B,C
E depends on D
F depends on E
```

Dạng graph giúp sau này chạy song song:

```text
- inspect frontend
- inspect backend
- inspect tests
```

Rồi merge kết quả lại thành plan.

Data model:

```ts
type ExecutionGraph = {
  nodes: ExecutionNode[];
  edges: {
    from: string;
    to: string;
    type: "depends_on" | "blocks" | "validates";
  }[];
};
```

Ban đầu bạn vẫn có thể chạy tuần tự, nhưng artifact đã support graph thì sau này mở rộng dễ hơn.

## “Workspace” nên có meaning rõ

Mình sẽ định nghĩa workspace như sau:

> Workspace là môi trường quản lý toàn bộ vòng đời công việc AI: từ task, plan, branch, execution, checks, PR, review, CI, cho tới learning.

Không nên chỉ hiểu workspace là “folder làm việc”.

Workspace có 4 thành phần:

```text
1. Project workspace
   Một repo/project với config, checks, policies, lessons.

2. Execution workspace
   Một run cụ thể, có artifact, state, logs, selected files, generated patches.

3. Git workspace
   Branch/worktree riêng cho task.

4. Team workspace
   UI cho người dùng/team xem, approve, review, retry, cancel, merge.
```

Về sau, bạn có thể dùng `git worktree` để mỗi work item có working directory riêng:

```text
repo/
workspaces/
  ai-fix-login-bug/
  ai-add-export-csv/
  ai-refactor-auth-service/
```

Điều này cho phép nhiều task chạy song song mà không đạp lên working tree chính.

## Điều nên làm ngay trong repo

Mình nghĩ bước tiếp theo cụ thể nhất là thêm một feature tên:

> **Work Item v1**

Scope rất gọn:

```bash
ai work create "Fix login redirect bug"
ai work assess <id>
ai work plan <id>
ai work run <id> --dry-run
ai work run <id> --branch
```

Artifact:

```text
.ai-system-artifacts/
  work-items/
    work_abc123/
      work-item.json
      assessment.json
      breakdown.json
      checklist.json
      plan.json
      runs/
```

Dashboard thêm tab:

```text
Work Items
  - status
  - risk
  - checklist progress
  - linked run
  - branch
  - PR
```

Sau đó mới thêm PR automation.

## Thứ tự ưu tiên mình khuyên

Nếu là mình, mình sẽ làm theo thứ tự này:

1. **Work item data model**
2. **Assessment engine**
3. **Task decomposition/checklist**
4. **Plan approval UI**
5. **Branch creation**
6. **Commit creation**
7. **PR creation**
8. **CI watcher**
9. **Auto-fix PR checks**
10. **GitHub issue → work item**
11. **Review comment → work item**
12. **Multi-task workspace board**
13. **Parallel workspaces bằng git worktree**

Không nên nhảy ngay vào GitHub App hoặc workspace phức tạp trước khi `WorkItem -> Plan -> Checklist -> Branch` thật chắc.

## Kết luận

Hướng bạn mô tả nên là:

> **Orchestra không phải AI coder. Orchestra là AI project/work executor cho software tasks.**

Agent/model chỉ là công cụ bên trong. Giá trị thật nằm ở việc Orchestra có thể:

* hiểu task,
* đánh giá rủi ro,
* chia nhỏ công việc,
* tạo checklist có evidence,
* lập plan,
* tạo branch,
* implement,
* chạy check,
* tự sửa,
* mở PR,
* theo dõi CI,
* học từ lỗi cũ,
* và hiển thị toàn bộ trong workspace.

Đây là hướng rất đáng theo, vì nó biến dự án từ “tool chạy lệnh AI” thành **hệ điều hành công việc cho AI-assisted software development**.

[1]: https://github.com/nghiant96/Orchestra-AI-Platform "GitHub - nghiant96/Orchestra-AI-Platform · GitHub"
[2]: https://raw.githubusercontent.com/nghiant96/Orchestra-AI-Platform/main/docs/RELEASE_NOTES_v0.9.md "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/nghiant96/Orchestra-AI-Platform/main/docs/OPERATIONS.md "raw.githubusercontent.com"
[4]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request?utm_source=chatgpt.com "Creating a pull request - GitHub Docs"
[5]: https://cli.github.com/manual/gh_pr?utm_source=chatgpt.com "GitHub CLI | Take GitHub to the command line"
[6]: https://docs.github.com/en/rest/pulls?utm_source=chatgpt.com "REST API endpoints for pull requests - GitHub Docs"
[7]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax?utm_source=chatgpt.com "Workflow syntax for GitHub Actions - GitHub Docs"
[8]: https://docs.github.com/en/actions/tutorials/authenticate-with-github_token?utm_source=chatgpt.com "Use GITHUB_TOKEN for authentication in workflows"
