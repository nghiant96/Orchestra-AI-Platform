# Orchestra AI Platform — Improvement Backlog & Real Worker Provider Execution

Generated: 2026-06-01

Implementation status: **P0-P2 completed for alpha**.

```txt
Completed in this batch:
- P0 alpha scripts and JS mirror drift check.
- P1 locked queue transitions, explicit worker start, heartbeat lease result contract.
- P1.5 MCP actor hardening with missing-actor rejection.
- P2 provider adapter seam, isolated git worktree foundation, artifact capture, command/env policy, and CodexProvider v1.

Still alpha:
- File-backed queue remains the backend.
- CodexProvider v1 is the only real provider adapter.
- Aider, Claude, Cursor, and Antigravity adapters remain future seams.
- Verification policy is captured as an artifact placeholder, not a full provider-driven test policy yet.
```

## 1. Current System Assessment

The current branch is at **alpha / preview-mergeable** level.

The system now has the core shape of an AI Workspace Control Plane:

```txt
User / CLI / Dashboard / MCP / Hermes optional
        ↓
Orchestra API Server
        ↓
Job Queue + Work Item Engine + Approval + Audit
        ↓
Local Worker
        ↓
Provider / Executor
        ↓
Logs / Artifacts / Diff / Verification Result
```

The previous blocking issues have been addressed:

```txt
- Dry-run no longer mutates files.
- Worker claim and terminal/checkpoint/lease/recover transitions use per-job locks.
- Complete/fail routes forward result payload.
- Worker workspace roots are validated with realpath.
- Hybrid mode currently behaves as worker-only to avoid double ownership.
- Worker jobs transition assigned -> running before provider execution.
- Busy heartbeats renew leases and report leaseRenewed/leaseError.
- CodexProvider v1 runs in an isolated git worktree and captures diff artifacts.
```

The system is ready for alpha usage, but there are still improvements needed before calling it beta or production-ready.

---

## 2. What “Real Worker Provider Execution” Means

### Current state

The Local Worker infrastructure exists and can:

```txt
- register with the server
- heartbeat
- claim jobs
- hold a lease
- transition claimed jobs to running
- execute dummy jobs or CodexProvider v1 jobs
- upload logs
- send mutation checkpoint
- complete or fail the job
```

The dummy executor remains available for lifecycle smoke tests. It can no-op or handle a test command like:

```txt
worker:write-file path::content
```

This is useful for testing the worker lifecycle. Real provider execution now starts with CodexProvider v1, which runs `codex exec` inside an isolated git worktree and returns diff/log artifacts to the queue result payload.

### Real Worker Provider Execution

“Real Worker Provider Execution” means the Local Worker actually runs coding agents/tools such as:

```txt
- Codex CLI
- Claude CLI
- Aider
- Cursor CLI
- Antigravity / AGY CLI
```

inside a controlled workspace/worktree, then captures the result and sends it back to Orchestra.

In other words:

```txt
Current:
  Worker receives job → dummy/no-op/write-file → complete

Real Worker Provider Execution:
  Worker receives job
  → prepare repo/worktree
  → select provider
  → run Codex/Claude/Aider/Cursor command
  → capture stdout/stderr/logs
  → detect changed files
  → create diff/artifact
  → run verification commands
  → upload logs/artifacts/result
  → complete/fail with evidence
```

### Why this matters

Without Real Worker Provider Execution, Orchestra is a strong orchestration shell but not yet doing real AI coding work.

With it, Orchestra becomes actually useful for:

```txt
- fixing code
- adding features
- refactoring
- reviewing PRs
- running tests
- creating patches
- producing artifacts
- preparing PR handoff
```

### Example flow

```txt
1. User creates work item:
   "Fix React Native Hermes DevTools connection issue"

2. Orchestra enqueues a job.

3. Local Worker claims the job.

4. Worker creates/uses an isolated worktree:
   .orchestra/worktrees/wi_123_fix-hermes-devtools

5. Worker runs provider:
   codex exec --cwd <worktree> --prompt <generated prompt>

6. Provider edits files.

7. Worker captures:
   - git diff
   - provider transcript
   - changed files
   - test output
   - command logs

8. Worker runs verification:
   pnpm typecheck
   pnpm lint
   cd android && ./gradlew assembleDebug

9. Worker completes job with:
   - resultSummary
   - artifactPath
   - workerLogs
   - diffSummaries
   - latestToolResults
   - execution metadata

10. Dashboard shows result and approval gate.
```

---

## 3. Priority 0 — Before Merge / Alpha Stabilization

### 3.1 Generated `.js` mirror policy

Decision for this alpha batch: **Option B — keep runtime `.js` mirrors committed**.

Reason:

```txt
- Existing runtime/bin paths already use source-side `.js` files.
- Moving to dist/ is a larger packaging migration and should not be mixed into worker-provider hardening.
- Drift is controlled by `pnpm check:js-mirrors`, which runs `tsc` and fails if generated `.js` or `tsconfig.tsbuildinfo` state changes.
```

Operational rule:

```bash
./node_modules/.bin/tsc
pnpm check:js-mirrors
```

### 3.2 Document current alpha limitations

Add a clear section in README / docs:

```txt
Current alpha limitations:
- Local Worker runtime exists.
- Worker executor supports dummy/no-op/write-file and CodexProvider v1.
- Aider/Claude/Cursor/Antigravity providers are not implemented yet.
- File-backed queue is intended for local/single-server alpha.
- Hermes integration is optional.
- Verification policy artifacts exist, but full provider-driven verification is still roadmap.
```

### 3.3 Add alpha smoke script

Add one command/script that proves the system works end-to-end:

```bash
pnpm orchestra:smoke
```

Expected result:

```txt
- worker registers
- job is claimed
- dry-run does not write file
- job completes
- logs appear in dashboard
```

---

## 4. Priority 1 — Worker / Queue Reliability

### 4.1 Lock terminal transitions too

`claimJob()` now uses file lock. Consider using the same per-job lock around:

```txt
- completeJob()
- failJob()
- saveCheckpoint()
- renewLease()
- recoverStalledJob()
```

Reason:

```txt
Terminal state transitions should be atomic too.
```

This reduces edge cases like:

```txt
- worker complete racing with stale lease detector
- fail racing with recover
- checkpoint racing with complete
```

### 4.2 Add explicit `running` transition for external workers

Current external worker flow is roughly:

```txt
queued → assigned → completed/failed
```

It should ideally be:

```txt
queued → assigned → running → completed/failed
```

Add endpoint:

```http
POST /jobs/:jobId/start
```

Payload:

```json
{
  "workerId": "worker_123",
  "leaseId": "lease_123"
}
```

Or start automatically when heartbeat comes with:

```json
{
  "status": "busy",
  "currentJobId": "job_123",
  "leaseId": "lease_123"
}
```

### 4.3 Heartbeat should report lease renew result

If worker heartbeat includes jobId + leaseId and lease renewal fails, server should return:

```json
{
  "ok": true,
  "worker": {},
  "leaseRenewed": false,
  "leaseError": "Invalid leaseId"
}
```

Or return HTTP 409 if worker is busy and lease is invalid.

This helps the worker stop early instead of discovering the issue only at complete/fail time.

### 4.4 Improve lock retry behavior

Current lock acquisition returns null quickly if a lock exists.

For alpha this is fine. For beta, consider:

```txt
- retry with backoff for 100–500ms
- expose lock contention metrics
- log stale lock recovery
```

### 4.5 Move from file-backed queue to SQLite later

File-backed queue is OK for alpha/local.

Recommended roadmap:

```txt
Alpha:
  file-backed JSON queue + file lock

Beta:
  SQLite queue with transactions

Production/team:
  Postgres/Redis queue
```

---

## 5. Priority 2 — Real Worker Provider Execution

This is the biggest next feature.

### 5.1 Add ProviderAdapter interface

Define a shared adapter contract:

```ts
export interface WorkerProviderAdapter {
  id: "codex" | "claude" | "aider" | "cursor" | "antigravity";
  capabilities: string[];

  execute(input: WorkerProviderExecutionInput): Promise<WorkerProviderExecutionResult>;
}
```

Input:

```ts
export interface WorkerProviderExecutionInput {
  jobId: string;
  task: string;
  cwd: string;
  worktreePath: string;
  dryRun: boolean;
  workflowMode?: string;
  workflowProfile?: string;
  approvalPolicy?: unknown;
  env: Record<string, string>;
}
```

Result:

```ts
export interface WorkerProviderExecutionResult {
  ok: boolean;
  summary: string;
  stdout: string;
  stderr: string;
  changedFiles: string[];
  diffText?: string;
  artifactPath?: string;
  toolResults?: unknown[];
  failure?: {
    code: string;
    message: string;
  };
}
```

### 5.2 Start with CodexProvider

First real provider should be Codex because it matches the project direction.

Example implementation:

```txt
CodexProvider:
  - builds prompt from job/task/context
  - runs Codex CLI in worktree
  - captures stdout/stderr
  - checks git diff
  - returns changed files and summary
```

Pseudo-command:

```bash
codex exec --cwd <worktree> "<prompt>"
```

Actual command should match your local Codex CLI contract.

### 5.3 Add AiderProvider later

Aider is useful as a worker backend because it already has:

```txt
- repo map
- direct file editing
- test/lint loop
- terminal-first workflow
```

Example command shape:

```bash
aider --yes --message "<prompt>" --model <model>
```

### 5.4 Add Claude/Cursor/Antigravity later

These should be separate adapters.

Do not hardcode provider behavior inside worker runtime.

Recommended layout:

```txt
ai-system/worker/providers/
  provider-adapter.ts
  codex-provider.ts
  aider-provider.ts
  claude-provider.ts
  cursor-provider.ts
  antigravity-provider.ts
```

### 5.5 Add provider selection policy

Worker should choose provider by:

```txt
- job.routingProfile
- workflowProfile
- worker capabilities
- configured provider availability
- fallback order
```

Example config:

```json
{
  "providers": {
    "default": "codex",
    "fallbacks": ["aider", "claude"],
    "codex": {
      "command": "codex",
      "mode": "exec"
    }
  }
}
```

---

## 6. Priority 3 — Worktree and Repo Execution

### 6.1 One job = one isolated worktree

Do not let worker mutate the main repo checkout directly.

Recommended model:

```txt
workspaceRoot/
  repos/
    cloudclassV5/
      main/
      worktrees/
        wi_123_fix-hermes-devtools/
        wi_124_update-codepush-api/
```

### 6.2 Worktree manager

Add:

```txt
ai-system/work/worktree-manager.ts
```

Responsibilities:

```txt
- create worktree for job
- reuse or cleanup stale worktree
- ensure path is inside workspace root
- resolve branch name
- cleanup after job depending on retention policy
```

### 6.3 Git diff capture

After provider execution:

```bash
git status --porcelain
git diff --binary
git diff --stat
```

Store as artifacts:

```txt
artifact/
  diff.patch
  diff-stat.txt
  changed-files.json
  provider-stdout.log
  provider-stderr.log
  verification.json
```

### 6.4 Delivery modes

Support:

```txt
dry-run:
  generate proposed patch/artifact only

write:
  apply changes to worktree but do not push

pr:
  push branch and create PR only after approval
```

---

## 7. Priority 4 — Verification / Evidence

### 7.1 Verification policy per repo

Add repo config:

```json
{
  "verify": [
    "pnpm typecheck",
    "pnpm lint",
    "pnpm test",
    "cd android && ./gradlew assembleDebug"
  ],
  "repairAttempts": 2
}
```

### 7.2 Command policy gate

Before running commands, check:

```txt
- command is allowed
- cwd is inside worktree
- command is not destructive
- command does not access forbidden paths
```

### 7.3 Evidence checklist

For Superpowers / strict-review profile, require evidence:

```txt
- plan artifact exists
- diff artifact exists
- verification command result exists
- review artifact exists
- approval proof exists if required
```

### 7.4 Self-repair loop

When verification fails:

```txt
1. capture failure logs
2. ask provider to repair
3. rerun verification
4. stop after repairAttempts
5. complete/fail with evidence
```

---

## 8. Priority 5 — MCP / Hermes / Operator Hardening

### 8.1 Hermes remains optional

Document clearly:

```txt
Hermes is optional.
Orchestra works standalone via CLI, Dashboard, REST API, or MCP.
```

### 8.2 Do not default MCP actor to operator

Current MCP fallback actor is too powerful.

Change from:

```ts
ctx.actor ?? { id: "hermes", role: "operator" }
```

To either:

```ts
if (!ctx.actor) throw new McpToolError("MCP actor is required", 401);
```

or:

```ts
ctx.actor ?? { id: "mcp", role: "agent" }
```

### 8.3 Approval relay should include proof

For MCP approval:

```json
{
  "jobId": "job_123",
  "action": "approve",
  "approvalProof": {
    "approvedBy": "nghia",
    "approvalSource": "dashboard|cli|hermes",
    "userConfirmationId": "confirm_123",
    "artifactHashes": []
  }
}
```

### 8.4 Hermes memory feedback

After job completion, export lesson:

```txt
- task
- repo
- failure pattern
- successful fix
- commands passed
- reusable lesson
```

Hermes/OpenMemory can ingest this later.

---

## 9. Priority 6 — Dashboard Improvements

### 9.1 Worker detail page

Show:

```txt
- worker status
- current job
- labels/capabilities
- workspace roots
- last heartbeat
- recent jobs
- drain/disable actions
```

### 9.2 Job timeline

Show timeline:

```txt
queued
assigned
running
checkpoint
logs
waiting approval
completed/failed
```

### 9.3 Artifact viewer

Improve artifact viewer for:

```txt
- diff.patch
- verification logs
- provider stdout/stderr
- changed files
- approval proof
```

### 9.4 Recovery UI

For stalled jobs:

```txt
- show reason
- show worktree path
- show last checkpoint
- allow operator recover/cancel
```

---

## 10. Priority 7 — Security Hardening

### 10.1 Do not upload raw provider transcript by default

Default:

```txt
upload scrubbed summary/logs only
```

Optional:

```env
ORCHESTRA_UPLOAD_RAW_TRANSCRIPTS=true
```

### 10.2 Expand secret redaction

Redact patterns:

```txt
- API keys
- OpenAI keys
- GitHub tokens
- npm tokens
- private keys
- AWS/GCP credentials
- bearer tokens
- cookies
```

### 10.3 Stronger forbidden path policy

Block access to:

```txt
~/.ssh
~/.aws
~/.config/gcloud
.env*
*.p12
*.mobileprovision
keystore
signing
GoogleService-Info.plist if configured as sensitive
google-services.json if configured as sensitive
```

### 10.4 Token rotation

Support:

```txt
- worker token rotation
- hermes token rotation
- server/admin token rotation
```

---

## 11. Priority 8 — Testing Plan

### 11.1 Concurrent claim test

Add real concurrent claim test:

```ts
await Promise.all([
  claim(workerA),
  claim(workerB),
  claim(workerC)
])
```

Assert:

```txt
- only one worker gets the job
- others get null/retry
```

### 11.2 Dry-run mutation test

Assert:

```txt
worker:write-file demo.txt::hello
dryRun=true
=> file does not exist
=> job completes
=> filesystemMutated=false
```

### 11.3 Non-dry-run mutation test

Assert:

```txt
dryRun=false
=> file exists
=> checkpoint saved
=> filesystemMutated=true
```

### 11.4 Symlink escape test

Create:

```txt
allowed/root/link -> /tmp/outside
```

Register worker with:

```txt
allowed/root/link
```

Assert registration fails.

### 11.5 Worker interruption test

Simulate:

```txt
worker claims job
worker checkpoints filesystem mutation
worker dies
lease expires
detectStaleLeases()
```

Assert:

```txt
job -> stalled
not requeued
```

### 11.6 MCP auth test

Assert MCP tools cannot run with missing/weak actor.

---

## 12. Suggested Roadmap

### Alpha

```txt
- Completed: .js mirror policy chosen for alpha.
- Completed: alpha limitations documented in README/backlog.
- Completed: end-to-end dry-run smoke script added.
- Completed: dummy executor retained for lifecycle smoke.
```

### Alpha+1

```txt
- Completed: assigned -> running transition via POST /jobs/:jobId/start.
- Completed: complete/fail/checkpoint/lease/recover transitions use per-job locks.
- Completed: heartbeat returns leaseRenewed/leaseError and invalid busy leases return 409.
- Completed: concurrent claim/start/terminal regression coverage added.
```

### Beta

```txt
- Completed for alpha: ProviderAdapter seam and CodexProvider v1.
- Completed for alpha: isolated git worktree manager.
- Completed for alpha: diff/log/changed-files/verification artifact capture.
- Remaining: full verification policy execution and richer dashboard artifact workflows.
```

### Beta+1

```txt
- Add AiderProvider
- Add Claude/Cursor/Antigravity adapters
- Add self-repair loop
- Improve dashboard artifact/timeline
```

### Production

```txt
- Move queue to SQLite/Postgres
- Harden MCP auth
- Strong token rotation
- Full audit trail
- Team/multi-user permissions
- CI/CD integration
```

---

## 13. Final Summary

The system is currently a strong alpha foundation.

It already has:

```txt
- server-side orchestration
- worker lifecycle
- lease and checkpoint
- work item workflow
- MCP integration
- optional Hermes layer
- dashboard visibility
```

The most important next step is:

```txt
Real Worker Provider Execution
```

because that turns the system from:

```txt
“a control plane that can manage jobs”
```

into:

```txt
“a control plane that can actually delegate coding work to AI tools and verify the result”
```
