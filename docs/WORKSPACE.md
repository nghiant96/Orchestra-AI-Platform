# AI Software Workspace — Domain Glossary

Last updated: 2026-05-02

## Overview

The AI Coding System is evolving from a single-shot task runner into an **AI Software Workspace** — a governed work-execution layer that turns engineering tasks into planned, checked, branch-based pull requests.

This document defines the core domain terms, artifact layout, migration rules, and relationship between the current run/job system and the future Work Item system.

## Core Domain Terms

### Run

A single end-to-end execution of the AI pipeline: plan → context → generate → check → review → fix → write.

- **Artifact directory**: `.ai-system-artifacts/run-<timestamp>-<random>/`
- **Key file**: `run-state.json`
- **Steps inside a run**: `01-plan/`, `02-context/`, `iteration-1/`, `00-routing/`, `timeline.jsonl`, `artifact-index.json`
- **CLI**: `ai "task description"`
- **Server**: `POST /run` (synchronous), `POST /jobs` (queued)

A run is the unit of AI execution. Runs are resumable from any paused or failed stage.

### Job

A queued server-side request that triggers a run.

- **Store**: `.ai-system-server/jobs/` (server-managed)
- **CLI**: Jobs are managed through the dashboard or `POST /jobs`
- **Access**: `GET /jobs?cwd=...`, `POST /jobs/:id/approve`, `POST /jobs/:id/cancel`

A job is a run scheduled through the server. Every job creates a run; not every run comes from a job.

### Project

A Git repository registered in the workspace with its own config, rules, artifacts, and lessons.

- **Config**: `.ai-system.json` at the repository root
- **Rules**: `ai-system/config/rules.json` (shipped with the system, overridable per project)
- **Registration**: Added via `POST /projects` (admin) or server configuration
- **Isolation**: Each project has its own artifacts, runs, lessons, queue view, and stats

Projects are the containment boundary. A project maps to one Git working tree.

### Work Item (Planned — Phase W1)

A durable entity representing a user-visible software task, independent of any single run.

- **Artifact directory**: `.ai-system-artifacts/work-items/<work-id>/`
- **Key files**: `work-item.json`, `assessment.json`, `task-graph.json`, `checklist.json`, `runs.json`
- **Planned CLI**: `ai work create`, `ai work list`, `ai work show`

A Work Item is the unit of **planning and tracking**. It can spawn zero or more runs. Unlike a run, a Work Item survives across multiple executions and has its own assessment, checklist, branch mapping, and PR metadata.

### Workspace

The top-level concept: the environment that manages the full lifecycle of software work.

Workspace has four layers:

1. **Project workspace** — A repo/project with config, checks, policies, lessons.
2. **Execution workspace** — A specific run with artifacts, state, logs, generated patches.
3. **Git workspace** — Branch/worktree isolated for a task.
4. **Team workspace** — Dashboard UI for viewing, approving, reviewing, retrying, cancelling, merging work across projects.

### Assessment (Planned — Phase W2)

A structured evaluation of a task before implementation begins.

- **Deterministic signals**: paths touched (auth, payment, security, migration), dependency changes, config/env changes, expected file count
- **AI judgment**: complexity, confidence, affected areas
- **Output**: risk class (low/medium/high/blocked), approval requirements

### Task Graph (Planned — Phase W3)

Decomposition of a Work Item into executable nodes with dependencies.

- **Node types**: inspect, test, implement, check, review, commit, PR, CI fix
- **Edges**: depends_on, blocks, validates
- **Execution**: Initially sequential; graph model supports future parallelism

### Checklist (Planned — Phase W3)

The execution contract for a Work Item. Each checklist item must have evidence before it can be marked `passed`.

- **Evidence types**: file, check result, artifact, commit metadata, PR metadata, approval event
- **Required items**: Cannot be passed without evidence; can be waived with reason and actor

### Evidence (Planned — Phase W3)

Proof that a checklist item is satisfied.

- **`file`**: A specific file exists at a given path and content state
- **`check`**: A check result (typecheck, lint, test) exists and passed
- **`artifact`**: A run artifact (plan, review, iteration manifest) exists
- **`commit`**: A git commit hash is recorded on the work item branch
- **`pr`**: A PR number and URL is linked to the work item
- **`approval`**: An explicit approval event from a human operator

## Artifact Layout

### Current layout (runs)

```
.ai-system-artifacts/
  run-2026-05-02T12-00-00Z-a1b2c3/
    00-routing/
      planning.json
      implementation.json
    01-plan/
      plan.json
    02-context/
      context.json
      files/
        src/example.ts
    iteration-1/
      manifest.json
      files/
        src/example.ts
      files-original/
        src/example.ts
    run-state.json
    artifact-index.json
    timeline.jsonl
    apply-events/
      apply-2026-05-02T12-05-00Z-d4e5f6.json
```

### Future layout (with Work Items)

```
.ai-system-artifacts/
  run-2026-.../               # Existing runs (unchanged)
  work-items/                 # New: Work Item storage
    work_abc123/
      work-item.json          # WorkItem fields
      assessment.json         # TaskAssessment (Phase W2)
      task-graph.json         # ExecutionGraph (Phase W3)
      checklist.json          # Checklist with evidence (Phase W3)
      runs.json               # Links to runs that executed this work item
      timeline.jsonl          # Work item lifecycle timeline
  schema-version.json         # Artifact schema version (existing)
```

## Migration Rule

**Old runs remain readable and do NOT require a Work Item.**

- Running `ai "fix a bug"` directly (without a Work Item) MUST continue to work.
- `POST /run` and `POST /jobs` MUST produce valid runs without creating a Work Item.
- A run is self-contained if it was started directly.
- A run is linked to a Work Item only when started via `ai work run <work-id>` (Phase W4+).
- When loading a run, the system checks for a linked Work Item in `runs.json`. If not found, the run is treated as a standalone run, identical to current behavior.
- Normalizers must handle both paths:
  - `runs.json` maps `run_<id>` → work item metadata (for linked runs)
  - Standalone runs have no work item reference (current behavior preserved)

## Relationship Diagram

```
                  ┌──────────────┐
                  │   WORKSPACE  │  (team UI, multi-project, governance)
                  └──────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌─────▼──────┐ ┌────▼─────┐
   │  PROJECT A  │ │  PROJECT B │ │  SERVER  │
   │  (repo)     │ │  (repo)    │ │  queue   │
   └──────┬──────┘ └─────┬──────┘ └────┬─────┘
          │              │              │
   ┌──────▼──────┐       │       ┌──────▼──────┐
   │ WORK ITEMS  │       │       │    JOBS     │
   │ ┌─────────┐ │       │       │ ┌─────────┐ │
   │ │WI #1    │ │       │       │ │Job #1   ├─┼──► Run #1
   │ │ ├─Run#1 │ │       │       │ └─────────┘ │
   │ │ ├─Run#2 │ │       │       │ ┌─────────┐ │
   │ │ └─PR#42 │ │       │       │ │Job #2   ├─┼──► Run #2
   │ └─────────┘ │       │       │ └─────────┘ │
   │ ┌─────────┐ │       │       └─────────────┘
   │ │WI #2    │ │       │
   │ │ └─Run#3 │ │       │
   │ └─────────┘ │       │
   └─────────────┘       │
                         │
                  ┌──────▼──────┐
                  │ STANDALONE  │
                  │    RUNS     │
                  │  (no WI)    │
                  └─────────────┘
```

- A **Project** contains **Work Items** and/or standalone **Runs**.
- A **Work Item** links to one or more **Runs**.
- A **Job** (server) creates a **Run**.
- The **Workspace** spans all projects, provides team visibility, and governs approvals across all layers.

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

Phase W0 is documentation-only. The only code change is a new smoke test file that MUST pass alongside existing tests.

## Phase W0 Acceptance Criteria

- [x] This glossary exists at `docs/WORKSPACE.md`.
- [x] Smoke test at `tests/workspace-baseline.test.ts` passes alongside existing test suite. ✅ 196/196 passed
- [x] `pnpm run typecheck`, `pnpm run lint`, `pnpm test` all pass. ✅ 196/196 passed
- [x] `pnpm run dashboard:build` and `pnpm --dir dashboard test` pass. ✅ 5/5 passed
- [x] Existing CLI/server/dashboard behavior is unchanged. ✅ No regressions
- [x] Old run artifacts remain loadable after this document exists. ✅ Verified via coexistence test
