# Orchestra AI Platform — Agent Implementation Roadmap

**Version:** 2026-06-12  
**Target repo:** `nghiant96/Orchestra-AI-Platform`  
**Product name:** Orchestra AI Platform  
**Primary CLI:** `ai`  
**Optional alias:** `orchestra`

---

## 0. Execution Update — 2026-06-12

This roadmap should be implemented as a production refactor, not as a
thin layer over the current artifact sprawl.

Current repository reality:

```txt
[exists] tests/worker-context-pack.test.ts
[exists] tests/worker-diff-boundary-checker.test.ts
[exists] tests/worker-naming-guard.test.ts
[exists] tests/worker-verification-artifacts.test.ts
[exists] tests/worker-phases.test.ts
```

Therefore, v0.9.1 should start with a gap analysis of existing tests and
extend those tests where possible. Do not create duplicate test files just
because this document names a new file. Create a new test file only when
the behavior is not naturally owned by an existing worker test.

Immediate implementation order:

```txt
1. Patch missing stabilization coverage in existing worker tests.
2. Add unified artifact schema and path constants.
3. Add JobArtifactStore interface, LocalArtifactStore, and manifest writer.
4. Move worker artifact writers onto shared path constants.
5. Update dashboard/job artifact allowlists to read the unified layout.
6. Only then implement Solo Mode.
```

Allowed refactor posture:

```txt
Prefer a clean shared artifact boundary over compatibility-by-copying.
It is acceptable to move current worker artifacts into subdirectories in
one deliberate migration, as long as tests, job-service allowlists, and
dashboard readers move with it.
```

Compatibility rules:

```txt
[must] manifest.json uses versioned plain JSON data only
[must] optional fields are omitted when absent, not serialized as undefined
[must] artifact references are relative paths under the job artifact root
[must] Team Mode and Solo Mode share the same artifact path constants
[must] dashboard-safe artifact allowlists are explicit
[must] provider stdout/stderr remain blocked unless raw transcripts are explicitly enabled
```

Do not implement `ai run`, `ai quick`, `ai safe`, `ai undo`, or
`ai continue` until v0.9.2 is merged and verified.

---

## 1. Product Direction

Orchestra should not compete with Cursor, Codex, Claude Code, or Copilot as a code-writing tool.

Orchestra should be positioned as:

> An AI coding workflow engine that turns AI coding tools into controlled, auditable, resumable workers with context, guardrails, verification, undo, and artifact evidence.

The system has two modes:

```txt
Solo Mode:
  Local-only workflow for individual developers.
  No server required.
  Fast task execution, continue, undo, diff explain, local artifacts.

Team Mode:
  Server + queue + worker + dashboard.
  Multi-worker execution, audit, durable state, dashboard evidence.
```

Shared core:

```txt
Task
 -> Context Pack
 -> Provider Execution
 -> Diff Boundary Guard
 -> Naming Guard
 -> Verification Runner
 -> Artifact Evidence
 -> Continue / Undo / Commit / Report
```

---

## 2. Current State Summary

Already implemented:

```txt
[done] Worker phases: setup -> implementation -> verification
[done] Context Pack model
[done] Context Pack parser
[done] Implementation phase consumes Context Pack
[done] Diff Boundary Guard
[done] Naming Guard
[done] Repo Convention Scanner
[done] Verification Runner
[done] Codex provider artifacts
[done] Server/worker execution model
[done] Store descriptor reports sqlite/postgres as reserved, not implemented
```

Next critical step:

```txt
Stabilize artifacts and tests before building Solo Mode.
```

---

## 3. Core Principles

### 3.1. Do not create two artifact systems

Avoid:

```txt
Team Mode:
  .ai-system-artifacts/run-xxx/

Solo Mode:
  .orchestra/jobs/job-xxx/

with different schemas
```

Use:

```txt
Same schema.
Different storage adapter.
```

Required abstraction:

```ts
interface JobArtifactStore {
  createJob(input: CreateJobArtifactInput): Promise<JobArtifactRef>;
  readManifest(jobId: string): Promise<JobArtifactManifest>;
  writeArtifact(jobId: string, artifact: ArtifactWriteInput): Promise<void>;
  readArtifact(jobId: string, path: string): Promise<string | Buffer | null>;
  listJobs(filter?: JobListFilter): Promise<JobArtifactSummary[]>;
}
```

Adapters:

```txt
LocalArtifactStore:
  .orchestra/jobs/<job-id>/

WorkerArtifactStore:
  .ai-system-artifacts/<job-id>/

Future:
  ServerArtifactStore / RemoteArtifactStore / S3 / MinIO
```

### 3.2. Keep `ai` as primary CLI

Primary commands:

```bash
ai run "Fix login loading state"
ai quick "Fix typo in README"
ai safe "Refactor payment session flow"
ai continue
ai undo last
ai job list
ai job show <job-id>
```

Optional alias later:

```bash
orchestra run "Fix login loading state"
```

Product name remains Orchestra. CLI should stay short as `ai`.

### 3.3. Memory must be namespaced

Default memory scope should be `project`, not global.

Suggested namespace:

```ts
interface MemoryNamespace {
  userId?: string;
  workspaceRootHash: string;
  projectId: string;
  repoRemote?: string;
  branch?: string;
  scope: "project" | "workspace" | "global";
}
```

Scopes:

```txt
project:
  repo conventions
  known risky files
  previous failures
  project-specific lessons

workspace:
  user workflow preferences
  machine-specific settings

global:
  generic Orchestra usage lessons only
```

---

## 4. Unified Artifact Layout

All modes should write artifacts using this layout:

```txt
<artifact-root>/<job-id>/
  manifest.json
  task.md
  phase-state.json

  context/
    context-pack.json
    context-pack.md
    pre-context-pack.json
    pre-context-pack.md
    repo-conventions.json

  provider/
    provider-stdout.log
    provider-stderr.log
    process.json

  diff/
    diff.patch
    diff-stat.txt
    changed-files.json

  guards/
    diff-boundary-check.json
    naming-check.json

  verification/
    verification.json
    checks/
      typecheck.log
      lint.log
      test.log
      build.log

  phases/
    setup-01-xxx.json
    implementation-02-xxx.json
    verification-03-xxx.json
```

---

## 5. Manifest Schema

Create:

```txt
ai-system/artifacts/artifact-schema.ts
```

Suggested shape:

```ts
export interface JobArtifactManifest {
  version: 1;

  jobId: string;
  mode: "solo" | "team";
  executionMode: "quick" | "normal" | "safe";
  status:
    | "created"
    | "running"
    | "failed"
    | "completed"
    | "cancelled"
    | "reverted";

  task: {
    title?: string;
    prompt: string;
    createdAt: string;
  };

  repo: {
    root: string;
    gitCommitBefore: string;
    gitCommitAfter?: string;
    branch?: string;
    worktreePath?: string;
  };

  provider: {
    id: "codex" | "claude" | "local" | string;
    command?: string;
  };

  artifacts: {
    task?: string;
    phaseState?: string;

    contextPack?: string;
    contextPackMarkdown?: string;
    preContextPack?: string;
    preContextPackMarkdown?: string;
    repoConventions?: string;

    providerStdout?: string;
    providerStderr?: string;
    process?: string;

    diffPatch?: string;
    diffStat?: string;
    changedFiles?: string;

    diffBoundaryCheck?: string;
    namingCheck?: string;

    verification?: string;
  };

  summary?: {
    changedFileCount: number;
    guardStatus: "passed" | "warning" | "failed" | "skipped";
    verificationStatus: "passed" | "failed" | "skipped";
  };
}
```

---

## 6. Artifact Path Constants

Create:

```txt
ai-system/artifacts/artifact-paths.ts
```

Suggested constants:

```ts
export const ARTIFACT_PATHS = {
  manifest: "manifest.json",
  task: "task.md",
  phaseState: "phase-state.json",

  contextPack: "context/context-pack.json",
  contextPackMarkdown: "context/context-pack.md",
  preContextPack: "context/pre-context-pack.json",
  preContextPackMarkdown: "context/pre-context-pack.md",
  repoConventions: "context/repo-conventions.json",

  providerStdout: "provider/provider-stdout.log",
  providerStderr: "provider/provider-stderr.log",
  process: "provider/process.json",

  diffPatch: "diff/diff.patch",
  diffStat: "diff/diff-stat.txt",
  changedFiles: "diff/changed-files.json",

  diffBoundaryCheck: "guards/diff-boundary-check.json",
  namingCheck: "guards/naming-check.json",

  verification: "verification/verification.json",
  checksDir: "verification/checks",
  phasesDir: "phases"
} as const;
```

---

## 7. Version Roadmap

```txt
v0.9.1  Stabilize current guards
v0.9.2  Unified Artifact Schema
v0.10   Solo Mode MVP
v0.11   Solo Productivity: continue / undo / history
v0.12   Context Builder: ripgrep + vector/OpenMemory provider
v0.13   Dashboard Evidence Viewer
v0.14   Durable Team Mode: SQLite + repositories
v0.15   Integration Intelligence: FE/BE endpoint guard
```

---

# v0.9.1 — Stabilize Current Guards

## Goal

Lock down the new core modules with tests before building Solo Mode.

## Tasks

### Task 1 — Add tests for Context Pack

Create:

```txt
tests/context-pack.test.ts
```

Coverage:

```txt
[x] normalizeWorkerContextPack fills fallback values
[x] normalizeWorkerContextPack removes invalid relevant files
[x] saveWorkerContextPack writes json and markdown
[x] loadWorkerContextPack reads valid pack
[x] createFallbackWorkerContextPack creates low confidence warning pack
```

Acceptance criteria:

```bash
pnpm test tests/context-pack.test.ts
```

---

### Task 2 — Add tests for Context Pack Parser

Create:

```txt
tests/context-pack-parser.test.ts
```

Coverage:

```txt
[x] extracts ORCHESTRA_CONTEXT_PACK raw JSON block
[x] extracts fenced JSON block
[x] returns null when marker missing
[x] returns fallback pack when JSON invalid
[x] handles balanced braces inside strings
```

Acceptance criteria:

```bash
pnpm test tests/context-pack-parser.test.ts
```

---

### Task 3 — Add tests for Diff Boundary Checker

Create:

```txt
tests/diff-boundary-checker.test.ts
```

Coverage:

```txt
[x] warns on low confidence context
[x] errors when touching doNotTouch path
[x] warns/errors when outside allowedDiffBoundary depending mode
[x] warns/errors for new file not declared depending new file policy
[x] supports exact paths
[x] supports path/**
[x] supports path/*
[x] supports simple * patterns
```

Acceptance criteria:

```bash
pnpm test tests/diff-boundary-checker.test.ts
```

---

### Task 4 — Add tests for Naming Guard

Create:

```txt
tests/naming-guard.test.ts
```

Coverage:

```txt
[x] catches S2HomeScreen
[x] catches SearchSA2match
[x] does not warn OAuth2Client
[x] does not warn H264Decoder
[x] warning mode does not fail
[x] strict mode fails
[x] test filename convention mismatch warning
```

Acceptance criteria:

```bash
pnpm test tests/naming-guard.test.ts
```

---

### Task 5 — Add tests for Repo Convention Scanner

Create:

```txt
tests/repo-convention-scanner.test.ts
```

Coverage:

```txt
[x] detects *Screen.tsx
[x] detects use*.ts hooks
[x] detects *Api.ts
[x] detects *.test.ts
[x] ignores dist/node_modules/.ai-system-memory/.orchestra
```

Acceptance criteria:

```bash
pnpm test tests/repo-convention-scanner.test.ts
```

---

### Task 6 — Add worker context-pack flow integration test

Create:

```txt
tests/worker-context-pack-flow.test.ts
```

Coverage:

```txt
[x] setup phase outputs ORCHESTRA_CONTEXT_PACK
[x] context-pack.json/md are saved
[x] implementation phase receives context pack
[x] boundary check runs after provider
[x] naming guard runs after provider
[x] verification runner still runs after guards
```

Acceptance criteria:

```bash
pnpm test tests/worker-context-pack-flow.test.ts
```

---

### v0.9.1 Definition of Done

```txt
[x] All new tests pass
[x] pnpm run typecheck passes
[x] pnpm run lint passes
[x] pnpm run check:all passes
```

---

# v0.9.2 — Unified Artifact Schema

## Goal

Create a shared artifact model used by both Solo Mode and Team Mode.

## Tasks

### Task 1 — Add artifact schema types

Create:

```txt
ai-system/artifacts/artifact-schema.ts
```

Implement:

```txt
JobArtifactManifest
ArtifactStatus
ArtifactExecutionMode
ArtifactMode
ArtifactRef
```

Acceptance criteria:

```txt
[x] Types compile
[x] Manifest shape covers current artifacts
```

---

### Task 2 — Add artifact path constants

Create:

```txt
ai-system/artifacts/artifact-paths.ts
```

Implement:

```txt
ARTIFACT_PATHS
phaseArtifactPath(phaseId: string): string
checkLogPath(name: string): string
```

Acceptance criteria:

```txt
[x] All paths use normalized forward slash
[x] No hard-coded artifact filenames remain in newly added modules
```

---

### Task 3 — Add JobArtifactStore interface

Create:

```txt
ai-system/artifacts/job-artifact-store.ts
```

Implement interfaces only.

Acceptance criteria:

```txt
[x] Interface supports create/read/write/list
[x] Interface does not assume local filesystem
```

---

### Task 4 — Add LocalArtifactStore

Create:

```txt
ai-system/artifacts/local-artifact-store.ts
```

Behavior:

```txt
rootDir default:
  .orchestra/jobs

createJob:
  creates <root>/<job-id>
  writes manifest.json
  writes task.md
  records gitCommitBefore if repo is git

writeArtifact:
  writes relative path under job root

readManifest:
  reads manifest.json

listJobs:
  reads all manifest.json
  sorts by createdAt desc
```

Acceptance criteria:

```txt
[x] LocalArtifactStore can create job
[x] LocalArtifactStore writes manifest
[x] LocalArtifactStore writes nested artifacts
[x] LocalArtifactStore lists jobs
```

---

### Task 5 — Refactor existing artifact writers to use artifact paths

Update:

```txt
ai-system/worker/context-pack.ts
ai-system/worker/diff-boundary-checker.ts
ai-system/worker/naming-guard.ts
ai-system/worker/repo-convention-scanner.ts
ai-system/worker/verification-runner.ts
ai-system/worker/providers/codex-provider.ts
ai-system/worker/job-executor.ts
```

Move existing artifacts into layout:

```txt
context/context-pack.json
context/context-pack.md
context/repo-conventions.json
diff/diff.patch
diff/diff-stat.txt
diff/changed-files.json
guards/diff-boundary-check.json
guards/naming-check.json
verification/verification.json
provider/provider-stdout.log
provider/provider-stderr.log
```

Acceptance criteria:

```txt
[x] Existing worker pipeline still runs
[x] Artifacts are written under new layout
[x] Tests updated accordingly
```

---

### Task 6 — Manifest updater

Create:

```txt
ai-system/artifacts/manifest-writer.ts
```

Functions:

```txt
writeInitialManifest(...)
updateManifestStatus(...)
updateManifestArtifactRefs(...)
updateManifestSummary(...)
```

Acceptance criteria:

```txt
[x] Manifest status changes from created -> running -> completed/failed
[x] Manifest artifact refs are updated after writing artifacts
```

---

### v0.9.2 Definition of Done

```txt
[x] Team worker uses unified artifact layout
[x] LocalArtifactStore exists
[x] manifest.json exists for new jobs
[x] Existing tests pass
[x] check:all passes
```

---

# v0.10 — Solo Mode MVP

## Goal

Allow individual developers to run guarded AI coding jobs without server/worker.

## Commands

```bash
ai run "Fix login loading state"
ai quick "Fix typo in README"
ai safe "Refactor payment session flow"
```

## Mode mapping

```txt
quick:
  context pack optional
  setup phase off
  boundary warn
  new file warn
  naming warn
  verification focused or optional

run / normal:
  context pack auto
  boundary warn
  new file warn
  naming warn
  verification run

safe:
  context pack required
  boundary strict
  new file strict
  naming warn or strict
  verification required
```

## Tasks

### Task 1 — Add solo runner

Create:

```txt
ai-system/solo/solo-runner.ts
```

Suggested interface:

```ts
export interface SoloRunInput {
  task: string;
  executionMode: "quick" | "normal" | "safe";
  repoRoot: string;
  providerId: string;
  providerCommand?: string;
}

export interface SoloRunResult {
  ok: boolean;
  jobId: string;
  artifactRoot: string;
  summary: string;
}
```

Behavior:

```txt
[ ] create LocalArtifactStore job
[ ] prepare artifact root
[ ] run provider directly
[ ] capture artifacts
[ ] run diff boundary guard
[ ] run naming guard
[ ] run verification runner
[ ] write manifest status
[ ] print summary
```

---

### Task 2 — Reuse core worker modules

Solo Mode should reuse:

```txt
context-pack.ts
context-pack-parser.ts
contextual-phase-prompt.ts
diff-boundary-checker.ts
naming-guard.ts
repo-convention-scanner.ts
verification-runner.ts
provider adapters
```

Acceptance criteria:

```txt
[ ] Solo Mode and Team Mode use same Context Pack schema
[ ] Solo Mode and Team Mode use same guard modules
[ ] Solo Mode and Team Mode use same verification runner
```

---

### Task 3 — Add CLI commands

Update CLI parser to support:

```bash
ai run "task"
ai quick "task"
ai safe "task"
```

Acceptance criteria:

```txt
[ ] ai run creates local job
[ ] ai quick creates quick local job
[ ] ai safe creates safe local job
[ ] command output includes artifact path
```

---

### Task 4 — Undo-ready artifacts

Solo MVP must produce undo-ready artifacts even before `ai undo` ships.

Required:

```txt
diff/diff.patch
diff/changed-files.json
manifest.json with gitCommitBefore
```

Acceptance criteria:

```txt
[ ] diff.patch can be applied in reverse with git apply -R
[ ] manifest includes gitCommitBefore
```

---

### v0.10 Definition of Done

```txt
[ ] ai run works without server
[ ] ai quick works without server
[ ] ai safe works without server
[ ] Artifacts use unified schema
[ ] Undo-ready diff exists
[ ] check:all passes
```

---

# v0.11 — Solo Productivity

## Goal

Make Solo Mode useful for daily development.

## Tasks

### Task 1 — Job history

Commands:

```bash
ai job list
ai job show <job-id>
ai job logs <job-id>
```

Behavior:

```txt
[ ] reads LocalArtifactStore
[ ] displays status, task, createdAt, changed file count
[ ] show reads manifest and key artifacts
```

---

### Task 2 — Continue

Commands:

```bash
ai continue
ai continue --job <job-id>
ai continue --fix-verification
```

Behavior:

```txt
[ ] default continues latest failed/incomplete job
[ ] reads manifest
[ ] reads context pack
[ ] reads verification result
[ ] if --fix-verification, prompt provider only with verification failures + current diff context
[ ] reruns guards and verification
```

---

### Task 3 — Undo

Commands:

```bash
ai undo last
ai undo <job-id>
```

Behavior:

```txt
[ ] read diff/diff.patch
[ ] run git apply -R
[ ] update manifest status to reverted
[ ] if reverse patch fails, print fallback instructions
```

---

### Task 4 — Diff explain

Command:

```bash
ai diff explain
ai diff explain <job-id>
```

Behavior:

```txt
[ ] reads changed-files.json
[ ] reads diff-stat.txt
[ ] optionally uses provider/local summarizer
[ ] prints readable per-file summary
```

---

### Task 5 — Commit helper

Command:

```bash
ai commit <job-id>
```

Behavior:

```txt
[ ] generate commit message from manifest + changed files + verification
[ ] show message before commit
[ ] optionally commit only changed files from job
```

---

# v0.12 — Context Builder

## Goal

Reduce reliance on AI setup phase by generating pre-context from deterministic and semantic sources.

## Tasks

### Task 1 — Add context builder

Create:

```txt
ai-system/context/context-builder.ts
```

Suggested interface:

```ts
export interface ContextBuilderInput {
  jobId: string;
  task: string;
  repoRoot: string;
  artifactDir: string;
}

export interface ContextCandidate {
  path: string;
  reason: string;
  source: "vector" | "ripgrep" | "git" | "convention" | "memory";
  score: number;
}

export interface BuiltContext {
  candidates: ContextCandidate[];
  preContextPack: WorkerContextPack;
}
```

---

### Task 2 — Add ripgrep candidate search

Use `rg` when available.

Behavior:

```txt
[ ] extract keywords from task
[ ] run rg -l
[ ] rank files by keyword hits
[ ] exclude ignored folders
```

Fallback:

```txt
If rg unavailable, use simple file scan or skip with warning.
```

---

### Task 3 — Add SemanticContextProvider interface

Create:

```txt
ai-system/context/semantic-context-provider.ts
```

Interface:

```ts
export interface SemanticContextProvider {
  search(input: {
    query: string;
    repoRoot: string;
    namespace: MemoryNamespace;
    limit: number;
  }): Promise<ContextCandidate[]>;
}
```

Initial implementation can be disabled/no-op.

---

### Task 4 — Add memory namespace

Create:

```txt
ai-system/memory/memory-namespace.ts
```

Implement:

```txt
workspaceRootHash
projectId
repoRemote
scope
```

Default scope:

```txt
project
```

---

### Task 5 — Write pre-context artifacts

Write:

```txt
context/pre-context-pack.json
context/pre-context-pack.md
```

Setup phase should receive pre-context as input and refine it into final context pack.

---

# v0.13 — Dashboard Evidence Viewer

## Goal

Make artifacts visible and understandable for demos/team use.

## Tasks

```txt
[ ] Add Job Detail artifact tabs
[ ] Add Context Pack viewer
[ ] Add Diff Boundary / Naming Guard viewer
[ ] Add Verification viewer
[ ] Dashboard reads manifest.json
```

Tabs:

```txt
Overview
Phases
Context Pack
Diff
Guards
Verification
Artifacts
```

---

# v0.14 — Durable Team Mode

## Goal

Move Team Mode from file-backed state toward durable SQLite-backed state.

## Tasks

```txt
[ ] JobRepository interface
[ ] FileJobRepository adapter
[ ] SqliteJobRepository
[ ] WorkerRepository
[ ] AuditRepository
[ ] Migration runner
```

Acceptance criteria:

```txt
[ ] ORCHESTRA_STORE=file still works
[ ] ORCHESTRA_STORE=sqlite works
[ ] server restart preserves jobs
[ ] worker restart does not duplicate jobs
[ ] audit entries persisted
```

---

# v0.15 — Integration Intelligence

## Goal

Add lightweight FE/BE endpoint mismatch detection without building full CodeGraph.

## Tasks

```txt
[ ] FE API call detector
[ ] BE route detector
[ ] Endpoint mismatch report
[ ] Write integration/integration-check.json
[ ] Warning only by default
```

Detect common patterns:

```txt
fetch(...)
axios.get/post/put/delete(...)
apiClient.get/post/put/delete(...)
Express router.get/post
NestJS @Controller + @Get/@Post
Fastify route
```

---

# Agent Execution Rules

## Rule 1 — Do not create duplicate systems

Solo Mode and Team Mode must share:

```txt
Context Pack schema
Guard schemas
Verification schema
Manifest schema
Artifact layout
```

## Rule 2 — Prefer small PRs

Recommended PR boundaries:

```txt
PR 1: tests for current guards
PR 2: artifact schema + local store
PR 3: artifact path refactor
PR 4: solo runner
PR 5: continue/undo
```

## Rule 3 — Keep CLI primary as `ai`

Do not rename primary CLI to `orchestra`.

## Rule 4 — Do not build full CodeGraph yet

Do not implement AST graph, multi-language graph, DTO matcher, or vector reranker in this roadmap stage.

Use:

```txt
ripgrep
git ls-files
repo convention scanner
OpenMemory/vector provider interface
```

## Rule 5 — Every new module needs tests

Every new module must include unit tests unless explicitly documented as a temporary spike.

## Rule 6 — Keep default modes safe but not annoying

Defaults:

```txt
ORCHESTRA_DIFF_BOUNDARY_MODE=warn
ORCHESTRA_NEW_FILE_POLICY=warn
ORCHESTRA_NAMING_GUARD_MODE=warn
ORCHESTRA_CONTEXT_PACK_MODE=auto
```

Strict only for:

```txt
ai safe
team high-risk workflow
explicit env strict mode
```

---

# Immediate Next Tasks

Give these to the agent in order.

## Task A — Stabilization tests

```txt
Implement v0.9.1 tests:
- context-pack.test.ts
- context-pack-parser.test.ts
- diff-boundary-checker.test.ts
- naming-guard.test.ts
- repo-convention-scanner.test.ts
- worker-context-pack-flow.test.ts

Run:
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run check:all
```

## Task B — Artifact schema foundation

```txt
Implement v0.9.2:
- artifact-schema.ts
- artifact-paths.ts
- job-artifact-store.ts
- local-artifact-store.ts
- manifest-writer.ts

Do not implement Solo Mode yet.
Only create schema and store foundation.
```

## Task C — Refactor artifact paths

```txt
Refactor existing artifact writers to use unified artifact paths:
- context-pack.ts
- diff-boundary-checker.ts
- naming-guard.ts
- repo-convention-scanner.ts
- verification-runner.ts
- codex-provider.ts
- job-executor.ts
```

## Task D — Solo Mode MVP

```txt
Implement:
- ai run
- ai quick
- ai safe
- SoloRunner
- local artifact creation
- undo-ready diff.patch
```

---

# Success Criteria

## For Solo Mode

```txt
[ ] Developer can run `ai run "task"` without server
[ ] Artifacts are created locally
[ ] Context Pack exists
[ ] Boundary/Naming/Verification results exist
[ ] Job can be continued
[ ] Job can be undone
[ ] Output is readable
```

## For Team Mode

```txt
[ ] Worker jobs still run
[ ] Worker jobs use same artifact schema
[ ] Dashboard can read artifacts
[ ] SQLite durable store can be introduced without rewriting artifact model
```

## For Technovation Demo

```txt
[ ] One command demo
[ ] Before/after story
[ ] Context Pack visible
[ ] Boundary/Naming guard visible
[ ] Verification visible
[ ] Short video/demo script
```

---

# Final Priority Order

If time is limited, do only this:

```txt
1. Add tests for current guards
2. Add unified artifact schema
3. Add LocalArtifactStore
4. Refactor artifact paths
5. Add ai run
6. Add ai undo
7. Add ai continue
8. Add dashboard artifact viewer
```

This sequence gives the highest product value with the lowest rework risk.
