# AI Software Workspace Roadmap

Last updated: 2026-05-02

## Feasibility Assessment

Converting the current system into an AI Software Workspace is feasible and strategically sound.

The current repo already has the core ingredients:

- Task execution lifecycle: plan, context, generate, checks, review, fix, write, resume, retry.
- Artifact-backed runs with run-state, artifact-index, routing artifacts, tool results, review output, and execution summaries.
- Queue/server/dashboard foundation with project registry, jobs, stats, lessons, roles, audit, and approval actions.
- Risk policy, Task Contracts, blast-radius context, missing-test detection, refactor analysis, external GitHub Issue/PR metadata, branch/commit/PR preview helpers, retention, normalizers, and webhook export.

The important product shift is not to compete with Codex, Gemini, or Claude. The product becomes:

> AI Software Workspace: a governed work-execution layer that turns engineering tasks into planned, checked, branch-based pull requests.

The model/agent remains a worker. The system owns workflow, state, evidence, permissions, git/PR handoff, and team visibility.

## Recommended Direction

Do not rewrite the current orchestrator. Add a higher-level Work Item layer above it.

Current shape:

```text
Task -> Orchestrator Run -> Artifacts
```

Target shape:

```text
Work Item
  -> Assessment
  -> Task Graph
  -> Checklist with Evidence
  -> One or more Orchestrator Runs
  -> Branch / Commit / PR
  -> CI / Review Feedback
  -> Final Report / Lessons
```

The workspace should manage multiple work items across projects, branches, approvals, PRs, checks, and learning.

## Design Principles

- Work items are durable entities, not transient prompts.
- Every important claim needs evidence: file, check result, artifact, commit, PR, or approval event.
- Generator/fixer should keep producing patches. Work engine decides where patches go.
- Git/GitHub/workspace logic must not be mixed into generator/fixer agents.
- Human approval remains explicit for writes, commits, pushes, PR creation, external comments, and risky actions.
- State must be resumable, inspectable, and auditable.
- Start sequential. Model the execution graph early so parallel execution can come later.
- Prefer CLI/GitHub CLI integration first; move to GitHub App/API when multi-user server operation requires it.

## Cost-Aware Execution Policy

The workspace model adds assessment, graph, checklist, review, PR, and CI feedback steps. Those steps must be cost-controlled by design instead of calling a model for every decision.

Principles:

- Use deterministic rules first. Call an LLM only when rules cannot confidently classify the task or when risk requires deeper reasoning.
- Keep a zero-LLM path for simple deterministic work such as docs-only edits, formatting/lint-only fixes, small config changes, small test updates, and evidence validation.
- Keep a fast path for small low-risk tasks: Work Item -> deterministic assessment -> one compact implementation run -> checks -> lightweight review.
- Require every model call to have a recorded reason to spend: ambiguity, high risk, failed check analysis, large diff review, user-facing/API/security change, or PR-facing output.
- Use fixed task graph templates for common task types instead of generating a fresh graph with an LLM every time.
- Never use an LLM to mark checklist items as passed. Checklist completion must be evidence-based.
- Use context budgets per run. Do not replay full roadmap, logs, artifact history, or repo context when a summary plus relevant files is enough.
- Cache project intelligence such as dependency graph, file summaries, Task Contracts, risk signals, and test mappings.
- Pass summaries between runs by default: `execution-summary.json`, `review-summary.json`, and `checks-summary.json` should be preferred over full artifact replay.
- Scale review depth by risk: lightweight review for low risk, normal review for medium risk, full staff-level review for high risk or PR-facing work.
- Use heuristic review before AI review. Escalate to full AI review only for high-risk, many-file, API/security/payment/auth, missing-test, or PR-facing changes.
- CI repair loops must have hard limits for attempts, cost, and duration.
- Route models by task class: cheaper/faster models for classification, summaries, and checklist drafts; stronger models for complex implementation and final review.
- Ask the user one clear question or produce an investigation report when missing information would otherwise cause multiple speculative model calls.

Execution tiers:

```text
Tier 0 - No LLM:
  docs-only changes
  formatting/lint-only fixes
  small config/test changes
  deterministic checklist/evidence validation
  cached project intelligence lookup

Tier 1 - Cheap LLM:
  task classification when rules are inconclusive
  log/check summarization
  PR/check summary
  short risk explanation

Tier 2 - Standard LLM:
  normal implementation
  medium bugfix
  targeted review
  focused test planning

Tier 3 - Strong LLM:
  architecture change
  security/auth/payment
  data migration
  broad refactor
  repeated CI failure
  final PR review for high-risk work
```

Escalation rule:

```text
Start at the lowest safe tier.
Escalate only with a recorded reason.
Stop or ask approval when budget is exceeded.
Do not call a stronger model just because a cheaper deterministic path is available.
```

Default budget policy:

```text
simple deterministic task:
  tier: 0
  model calls: 0
  review: heuristic/check-based

low-risk task:
  tier: 0-2 depending on ambiguity
  max implementation runs: 1
  assessment: deterministic
  task graph: template
  review: heuristic or lightweight

medium-risk task:
  tier: 1-2
  max implementation runs: 1-2
  assessment: deterministic plus optional LLM
  task graph: template plus targeted adjustment
  review: normal

high-risk task:
  tier: 2-3
  assessment: deterministic plus LLM-assisted validation
  task graph: explicit graph with approval checkpoints
  review: full staff-level review
  writes/branch/commit/PR: approval-gated

CI repair:
  default max attempts: 2
  full-context retry: at most 1
  stop on repeated failure class or budget exhaustion

full repo context:
  forbidden unless explicitly approved

artifact replay:
  summary-only by default
```

Target cost envelope:

- Simple deterministic tasks should use zero model tokens for workspace overhead and may cost less than the current run-only model.
- Common low/medium-risk tasks should keep token growth around 5-20% versus the current run-only model.
- Complex high-risk tasks may spend more tokens, but the extra spend must reduce blind retries, improve review quality, or produce auditable evidence.
- CI feedback is the highest cost risk and must be budget-limited before automatic repair is enabled.

## Target Domain Model

### WorkItem

Represents a user-visible software task.

Fields:

- `id`
- `projectId`
- `title`
- `description`
- `source`: `manual`, `github_issue`, `github_pr`, `ci_failure`, `api`, `webhook`
- `type`: `bugfix`, `feature`, `refactor`, `test`, `docs`, `investigation`, `review`
- `status`
- `risk`
- `expectedOutput`: `report`, `patch`, `branch`, `pull_request`
- `createdBy`
- `createdAt`, `updatedAt`
- `externalTask`
- `linkedRuns`
- `branch`
- `pullRequest`

### TaskAssessment

Represents deterministic plus AI-assisted task assessment.

Fields:

- `complexity`: `small`, `medium`, `large`
- `risk`: `low`, `medium`, `high`, `blocked`
- `confidence`
- `affectedAreas`
- `requiresBranch`
- `requiresHumanApproval`
- `requiresFullTestSuite`
- `tokenBudget`
- `modelTier`
- `reason`
- `signals`

### ExecutionGraph

Represents task decomposition.

Fields:

- `nodes`: inspect, test, implement, check, review, commit, PR, CI fix
- `edges`: dependency, blocker, validation
- `status` per node
- `assignedRunId` per node when executed

### Checklist

Checklist is the execution contract.

Fields:

- `id`
- `text`
- `required`
- `status`: `todo`, `doing`, `passed`, `failed`, `waived`
- `evidence`: file, check, artifact, commit, PR, review, audit event

Checklist items should not become `passed` without evidence.

## Architecture Target

Suggested module layout:

```text
ai-system/work/
  work-item.ts
  assessment.ts
  task-graph.ts
  checklist.ts
  evidence.ts
  work-store.ts
  work-engine.ts
  state-machine.ts

ai-system/git/
  branch-manager.ts
  worktree-manager.ts
  commit-manager.ts
  diff-manager.ts

ai-system/github/
  github-cli.ts
  issue-client.ts
  pr-client.ts
  checks-client.ts
  review-comments.ts

ai-system/workspace/
  inbox.ts
  work-board.ts
  notifications.ts
  workspace-api.ts

ai-system/policy/
  action-permissions.ts
```

Keep existing modules and reuse them:

- `core/orchestrator.ts`
- `core/run-executor.ts`
- `core/artifacts.ts`
- `core/risk-policy.ts`
- `core/task-requirements.ts`
- `core/blast-radius.ts`
- `core/git-workflow.ts`
- `core/external-task.ts`
- `core/job-queue.ts`
- `server-app.ts`

## Phase W0 - Workspace Baseline And Compatibility

Goal: establish workspace direction without destabilizing current task/run flows.

Tasks:

- Add workspace roadmap and glossary.
- Inventory current artifact schemas and decide where Work Item artifacts live.
- Define migration rule: old runs remain readable and do not require a Work Item.
- Add docs explaining the distinction between run, job, project, work item, and workspace.
- Add smoke test that current `POST /jobs`, `/jobs`, `/stats`, `/audit`, and dashboard still work after workspace files exist.

Acceptance:

- Existing CLI/server/dashboard behavior is unchanged.
- Workspace artifacts can coexist with `.ai-system-artifacts/run-*`.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, dashboard build/test pass.

## Phase W1 - Work Item v1 Data Model And Store

Goal: create durable Work Items independent from a single run.

Tasks:

- Add `WorkItem`, `TaskAssessment`, `ExecutionGraph`, `ChecklistItem`, and `EvidenceRef` types.
- Add file-backed work store:
  - `.ai-system-artifacts/work-items/<work-id>/work-item.json`
  - `assessment.json`
  - `task-graph.json`
  - `checklist.json`
  - `runs.json`
- Add normalizers and schema version.
- Add listing/loading APIs.
- Add tests for new and old/missing fields.

Suggested commands:

```bash
ai work create "Fix login redirect bug"
ai work list
ai work show <work-id>
```

Acceptance:

- Work items can be created, listed, loaded, and normalized.
- No orchestrator run is required just to create a work item.
- Old run artifacts still load.

## Phase W2 - Assessment Engine

Goal: turn raw task text into a structured assessment before implementation.

Tasks:

- Add deterministic assessment signals:
  - auth/payment/security/migration/deployment
  - config/env/secrets
  - dependency/lockfile
  - expected file count
  - external issue/PR source
  - requested output: report, branch, PR
- Reuse `risk-policy.ts` for risk class.
- Add optional planner-assisted assessment behind schema validation.
- Persist `assessment.json`.
- Surface assessment in CLI and dashboard Work Item detail.

Suggested commands:

```bash
ai work assess <work-id>
ai work create "..." --assess
```

Acceptance:

- Low/medium/high/blocked risk is explainable.
- Assessment does not write files.
- Assessment can require approval before later write/branch actions.

## Phase W3 - Task Graph And Evidence Checklist

Goal: decompose work into a graph and enforce evidence-based checklist completion.

Tasks:

- Add `ExecutionGraph` builder.
- Start with sequential execution but store graph nodes/edges.
- Add default decomposition templates:
  - bugfix
  - feature
  - refactor
  - review
  - CI failure
- Add checklist generation from graph plus Task Contracts.
- Add evidence validation:
  - file exists
  - check result exists and passed
  - run artifact exists
  - commit/PR metadata exists
  - approval event exists
- Prevent required checklist item from passing without evidence.

Acceptance:

- Bugfix tasks generate inspect/test/implement/check/review/PR nodes.
- Checklist progress is evidence-backed.
- Waived required items require reason and actor.

## Phase W4 - Work Engine Integration With Orchestrator

Goal: execute work graph nodes through existing orchestrator runs.

Tasks:

- Add `WorkEngine` that maps graph nodes to orchestrator tasks.
- Link work item to one or more run IDs.
- Persist node status from run result.
- Reuse existing approval policy and confirmation checkpoints.
- Add resume behavior:
  - resume work item
  - resume failed node
  - retry from run checkpoint
- Add failure classification at work-item level.

Suggested commands:

```bash
ai work run <work-id> --dry-run
ai work resume <work-id>
ai work retry <work-id> --node <node-id>
```

Acceptance:

- A work item can run through at least one orchestrator node.
- Work item status follows linked run status.
- Evidence is attached after checks/review complete.

## Phase W5 - Workspace API And Dashboard Work Board

Goal: make Work Items visible and operable in the dashboard.

Tasks:

- Add server routes:
  - `GET /work-items`
  - `POST /work-items`
  - `GET /work-items/:id`
  - `POST /work-items/:id/assess`
  - `POST /work-items/:id/run`
  - `POST /work-items/:id/cancel`
  - `POST /work-items/:id/retry`
- Add dashboard pages:
  - Inbox
  - Work Board
  - Work Item Detail
- Work Item Detail sections:
  - assessment
  - task graph
  - checklist
  - linked runs
  - branch/PR
  - checks
  - audit
- Keep current job feed available.

Acceptance:

- User can create and inspect a work item from dashboard.
- Dashboard shows checklist progress and evidence.
- Job/run views still work.

## Phase W6 - Branch And Worktree Automation

Goal: isolate work items into branch/worktree execution environments.

Tasks:

- Add branch manager using existing `git-workflow.ts` helpers.
- Add optional `git worktree` manager:
  - create worktree per work item
  - map work item to worktree path
  - cleanup/retain policy
- Add dirty-worktree checks.
- Add approval boundary before branch creation and artifact apply.
- Persist branch/worktree metadata.

Suggested commands:

```bash
ai work run <work-id> --branch
ai work branch <work-id>
ai work worktree create <work-id>
```

Acceptance:

- Branch names are safe and traceable.
- Work item branch/worktree metadata is persisted.
- No destructive git commands are used automatically.
- Unrelated working tree changes are detected and protected.

## Phase W7 - Commit And PR Automation

Goal: turn completed work items into reviewable PRs with high-quality evidence.

Tasks:

- Add approval-gated artifact apply/stage/commit path for work items.
- Generate commit message from work item, assessment, checklist, files, tests.
- Generate PR body from verified evidence:
  - summary
  - assessment
  - plan/checklist
  - files changed
  - checks
  - review notes
  - risks
  - artifacts
  - rollback
- Start with `gh` CLI preview/create behind approval.
- Persist PR metadata.
- Audit branch/commit/PR actions.

Suggested commands:

```bash
ai work commit <work-id>
ai work pr preview <work-id>
ai work pr create <work-id>
```

Acceptance:

- PR body is grounded in evidence, not invented claims.
- PR creation never happens without explicit approval.
- No direct push to protected branch by default.

## Phase W8 - CI Feedback Loop

Goal: watch PR checks and create follow-up fixes when CI fails.

Tasks:

- Add CI check collector:
  - first via `gh pr checks`
  - later via GitHub API/App
- Normalize CI failures into internal fix tasks.
- Link CI fix runs back to same work item/PR.
- Add loop limits:
  - max CI repair attempts
  - max cost
  - max duration
- Add final CI status and residual-risk report.

Suggested commands:

```bash
ai work ci watch <work-id>
ai work ci fix <work-id>
ai fix-ci --pr <number>
```

Acceptance:

- CI failure can produce a structured repair task.
- Fix commits stay on the work item branch.
- System stops when budget/attempt limit is reached.

## Phase W9 - Inbox Integrations

Goal: bring external work into the workspace.

Tasks:

- GitHub Issue to Work Item.
- GitHub PR to review Work Item.
- CI failure to Work Item.
- Webhook/API intake.
- Optional Slack/Jira/Trello later.
- Deduplication by external source URL/id.
- Human approval for automatically imported work.

Suggested commands:

```bash
ai work from-issue <url>
ai work from-pr <url>
ai work inbox sync
```

Acceptance:

- External work appears in Inbox without manual context copying.
- Duplicate external items do not create duplicate active work.
- Imported work is not executed until policy permits it.

## Phase W10 - Parallel Workspace Execution

Goal: run multiple work items safely.

Tasks:

- Use worktree isolation for concurrent execution.
- Add scheduler with per-project concurrency.
- Add dependency graph between work items.
- Prevent conflicting file scopes from running in parallel unless isolated.
- Add dashboard visibility for active workspaces.
- Add cleanup policy for old worktrees.

Acceptance:

- Multiple work items can run without touching the same working tree.
- Conflicts are detected before execution.
- Operators can pause/resume/cancel per work item.

## Phase W11 - Team Governance And Productization

Goal: mature workspace for team usage.

Tasks:

- Team roles and project-level permissions.
- Approval policies per action:
  - assess
  - plan
  - write
  - branch
  - commit
  - PR
  - external comment
  - merge
- Notification center.
- Audit export.
- Workspace analytics:
  - cycle time
  - PR success rate
  - CI repair rate
  - repeated failure classes
  - checklist completion quality
- Retention/migration docs for workspace artifacts.

Acceptance:

- Team can answer who approved what, when, and why.
- Workspace supports multiple projects and operators cleanly.
- Artifacts remain readable across schema versions.

## Recommended First Implementation Sprint

Start with `Work Item v1`, not PR automation.

Sprint scope:

1. Add `ai-system/work/` types and file store.
2. Add `ai work create/list/show`.
3. Persist `work-item.json` under `.ai-system-artifacts/work-items`.
4. Add assessment skeleton using existing risk policy.
5. Add checklist model with evidence refs.
6. Add tests for create/list/show/normalize.
7. Add a minimal dashboard Work Items list only after CLI/store is stable.

Do not start with:

- GitHub App.
- Multi-user auth provider.
- Full PR watcher.
- Parallel worktree execution.

Those are later layers after Work Item state is durable.

## Verification Gates

Every workspace phase with code changes must pass:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
git diff --check
```

If Git/GitHub behavior changes:

```bash
pnpm exec node --import tsx --test tests/git-workflow.test.ts
```

If server/workspace API changes:

```bash
pnpm exec node --import tsx --test tests/server-queue.test.ts
```

## Main Risks

- Scope creep: workspace can become too broad if Work Item v1 is not kept small.
- State duplication: Work Item state must reference runs, not copy all run data.
- Git safety: branch/worktree operations must never overwrite user changes.
- Evidence quality: checklist without evidence becomes another AI claim.
- Dashboard complexity: add Work Board progressively; do not bury current job feed.
- External integrations: GitHub App should wait until CLI-based PR flow proves useful.

## Decision

Proceed with the workspace conversion.

The recommended next milestone is:

> Work Item v1: durable work item, assessment, task graph skeleton, evidence checklist, and CLI create/list/show.
