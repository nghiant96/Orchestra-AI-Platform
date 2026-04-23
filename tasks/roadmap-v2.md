# Product Roadmap v2

This roadmap reflects the current state of AI-CODING-SYSTEM after the verified execution, operator visibility, scoped execution, and practical review workflow work already landed.

## Status Legend

- `done`: implemented and verified
- `in_progress`: active implementation slice
- `next`: highest-priority work after the current slice
- `later`: important, but not on the immediate critical path

## Current System Snapshot

Already strong today:
- verified execution with structured tool checks
- artifact-backed resume and apply audit trail
- operator commands for routing and run visibility
- scoped `ai review` for working tree, staged, base ref, and explicit file subsets
- scoped lint/test/typecheck heuristics for workspace repos

Current bottlenecks:
- tool execution still runs directly on the host machine
- execution flow needs explicit stage transitions for safer resume/retry evolution
- automation is still optimized most deeply for Node.js / TypeScript projects

## Phase A: Sandboxing & Safety

### Phase A1: Safety Foundation

Status: `done`

Goal:
- introduce an execution abstraction that can run tool checks in a more controlled environment before full container sandboxing lands

Delivered:
- tool execution now supports sandbox modes
- initial modes:
  - `inherit`
  - `clean-env`
- `clean-env` preserves only a curated allowlist of environment variables plus explicit passthrough keys
- CLI/operator output now exposes tool sandbox mode

Why this matters:
- it reduces accidental host-environment coupling
- it creates a clean seam for a future container runner

### Phase A2: Container Sandboxing

Status: `done`

Goal:
- run tool checks inside an isolated container or sandboxed execution target

Scope:
- Docker-based tool runner
- repo mount + working directory mapping
- env passthrough policy
- timeouts, logs, and failure reporting that match the current tool result model

Suggested deliverables:
- `tools.sandbox.mode = "docker"`
- image / runner config in `.ai-system.json`
- operator visibility for container image and mount strategy

## Phase B: Context Intelligence

Status: `in_progress`

Goal:
- improve context selection quality so planning/review depends less on file-name heuristics

Scope:
- dependency-aware file expansion
- import/reference graph hints
- ranked context selection instead of flat file lists

Suggested deliverables:
- dependency graph builder
- context expansion around changed symbols/files
- smarter top-K context selection
- Delivered in MVP:
  - dependency-aware expansion around planner-selected files
  - embedded local vector index with semantic chunk search
  - symbol-aware chunking so semantic matches stay near function/class boundaries before falling back to fixed-size blocks
  - orchestrator integration that appends top semantic matches to `plan.readFiles`
  - ranked context selection that prioritizes planner-selected files, write targets, dependency neighbors, and semantic matches
  - working-tree change hints that promote dirty files only when they are dependency-connected to the current plan
  - operator visibility for ranked context contributors in run artifacts and summaries
  - budget-aware context trimming that keeps pinned/high-value files and drops oversized low-value candidates before prompt assembly

## Phase C: Cross-Language Tooling

Status: `later`

Goal:
- make verified execution practical beyond Node.js / TypeScript repos

Scope:
- Python (`ruff`, `pytest`)
- Go (`go test`, `go vet`)
- Rust (`cargo test`, `cargo clippy`)

## Phase D: Adaptive Routing

Status: `done`

Goal:
- make provider routing learn from historical execution quality

Scope:
- provider outcome tracking
- task/risk-aware feedback loop
- route selection influenced by prior tool/review outcomes
- Delivered:
  - artifact-backed adaptive routing that reads recent run outcomes from `.ai-system-artifacts`
  - category-aware history buckets (`docs`, `risky`, `general`)
  - profile scoring adjustments based on recent provider success/failure by role
  - role-level adaptive overrides when one provider materially outperforms another for the same category

## Phase F: Resilient Execution Flow

Status: `done`

Goal:
- replace implicit execution state with explicit stage transitions so resume/failure handling can evolve without layering more hidden control flow

Delivered:
- explicit execution state machine with entered/completed/failed/paused/cancelled transitions
- transition persistence into artifact timelines during live runs
- execution summaries now include:
  - `transitions`
  - `currentStage`
  - `terminalStage`
- orchestrator and generation loop now drive:
  - planning routing
  - context loading
  - generation/fix iterations
  - tool checks
  - review
  - write
  - memory store
  through the state machine instead of raw step logging
- CLI run summaries now surface execution stage information directly

## Phase E: Platform Orchestration

Status: `later`

Goal:
- support queueing, scheduling, and multi-project workflows

Scope:
- service mode
- scheduled runs
- multi-project coordination
