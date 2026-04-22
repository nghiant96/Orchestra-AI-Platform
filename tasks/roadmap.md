# Product Roadmap

This roadmap tracks the next phases needed to turn AI-CODING-SYSTEM from a solid local orchestrator into a more practical day-to-day coding tool.

## Status Legend

- `done`: implemented and verified
- `next`: highest-priority work to do next
- `later`: important, but not on the immediate critical path

## Phase 1: Verified Execution Runtime

Status: `done`

Goal:
- Make code generation flow execute real repository checks instead of relying only on AI review.

Delivered:
- Generic tool execution layer for structured repo checks
- JSON validation in the tool pipeline
- Auto-detected `lint` / `typecheck`
- Optional `build` / `test` hooks in config
- Tool results persisted into iteration artifacts
- Tool failures fed back into the review/fix loop

Key files:
- `/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/tool-executor.ts`
- `/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/run-executor.ts`
- `/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/artifacts.ts`

## Phase 2: Operator Visibility

Status: `next`

Goal:
- Make each run easier to understand, debug, and trust.

Scope:
- Add tool execution summaries to CLI output
- Add a compact run summary command
- Show routing decision reasons more clearly
- Surface per-step duration and failure class
- Improve artifact index so the latest run is easier to inspect quickly

Suggested deliverables:
- `ai runs latest`
- `ai explain-routing`
- richer `artifact-index.json`
- execution summary in final CLI result

Delivered so far:
- final CLI result now includes latest tool execution summaries
- `ai doctor` shows effective tool commands and scoping
- `ai runs latest` reads artifact-backed run summaries directly from the CLI
- `ai explain-routing` explains routing from either the current task/config or the latest artifact-backed run

Why this is next:
- The runtime now executes real checks, but operators still have to inspect raw artifacts too often.
- Better visibility will make the system much easier to use repeatedly.

## Phase 3: Project Tool Configuration

Status: `next`

Goal:
- Let each project control exactly how `lint`, `typecheck`, `build`, and `test` should run.

Scope:
- Extend `.ai-system.json` schema for tool definitions
- Support custom commands and script names cleanly
- Support per-tool timeouts/retries
- Add setup/config UX for tools
- Document common patterns

Suggested deliverables:
- per-tool config examples
- `ai setup` support for enabling/disabling checks
- `ai config show` displaying tool settings

Why this matters:
- Auto-detection is good for the default path, but practical usage requires project-specific control.

## Phase 4: Scoped Execution

Status: `later`

Goal:
- Reduce cost and latency by running checks only where needed.

Scope:
- Run lint/test/typecheck against changed files or impacted targets when possible
- Add repo heuristics for monorepos and package boundaries
- Avoid running heavy checks unnecessarily

Suggested deliverables:
- changed-file aware linting
- affected-package test/build selection
- repo heuristics for pnpm workspaces

Why this is later:
- It depends on having stable tool configuration and good observability first.

## Phase 5: Workflow Modes

Status: `later`

Goal:
- Turn the runtime into a clearer day-to-day tool with explicit operator workflows.

Scope:
- `ai implement`
- `ai review`
- `ai fix`
- `ai apply --from-artifact`
- better resume/run selection UX

Why this matters:
- The engine already supports much of the behavior, but explicit workflows will reduce operator overhead.

## Phase 6: Adaptive Routing

Status: `later`

Goal:
- Improve provider selection using historical outcomes instead of only heuristics.

Scope:
- Record provider success/failure patterns
- Learn which providers work better by task/risk type
- Use artifact/run history to influence routing

Why this is later:
- Adaptive routing only becomes useful once execution quality and observability are already strong.

## Phase 7: Platform Orchestration

Status: `later`

Goal:
- Support queues, scheduling, multi-project automation, and service-style operation.

Scope:
- multi-project coordination
- scheduling / queueing
- external orchestration integrations
- service workflows beyond single local operator usage

Why this is last:
- It expands the product surface significantly and should come after the core runtime is mature.
