# AI Software Workspace Roadmap

Last updated: 2026-05-03

## Current Read

The repo is past the "does it work" stage. The current job is to turn it into a product people can trust:

- server auth and `.env` loading are in place
- the CLI loop is solid enough to keep improving
- dashboard and workspace APIs exist
- work items, graph, checklist, branch, PR, audit, and retention are already real
- the remaining gap is product coherence, release readiness, and team-scale control

The right roadmap is not "build more agent features". It is:

1. stabilize the current platform
2. make the core execution loop excellent
3. finish the workspace control plane
4. add team-level governance and observability
5. connect external task sources
6. scale cost and reliability without losing control

## Principles

- Keep the core single-task loop reliable before widening scope.
- Use deterministic rules first; spend model tokens only when the rules are not enough.
- Every state transition must be traceable to evidence.
- Workspace features should be additive, not destructive, until they prove themselves.
- User-facing claims must match code and docs.
- Approval remains explicit for writes, branch creation, PR creation, and risky actions.

## Phase A - Stabilize v0.9

Goal: make the repo cloneable, runnable, and understandable by someone new.

Tasks:

- Make dev startup deterministic:
  - root `.env.example`
  - clear `AI_SYSTEM_SERVER_TOKEN` setup
  - `local:dev` path that works without guesswork
- Keep docs aligned with runtime behavior:
  - server host/token behavior
  - auth expectations
  - workspace preview vs shipped features
- Publish a small demo path:
  - one simple bugfix
  - one dashboard walkthrough
  - one artifact trace
- Clean release hygiene:
  - tags
  - changelog/release notes
  - CI green on root tests and dashboard build

Acceptance:

- A fresh clone can run the system without reading source code first.
- `pnpm test` and `pnpm run dashboard:build` pass in CI.
- README, security docs, and startup scripts say the same thing.

## Phase B - Make the Core Loop Excellent

Goal: reduce retries, bad generations, and noisy checks.

Tasks:

- Improve run summaries and retry hints.
- Make JSON extraction and validation stricter and more explainable.
- Keep provider routing measurable:
  - success rate
  - latency
  - retry rate
  - budget usage
- Improve changed-file scoping and fallback check selection.
- Make context selection more transparent:
  - why a file was included
  - why a file was dropped
  - what the risk signals were
- Keep repair loops budgeted and bounded.

Acceptance:

- Simple bugfixes finish with fewer blind retries.
- Tool-check failures point to the real issue, not a generic wrapper error.
- Simple tasks can stay cheap; expensive tasks must justify their cost.

## Phase C - Finish Workspace Engine v1 Preview

Goal: make a work item a durable execution object, not just a wrapped task.

Tasks:

- Keep the work item data model authoritative:
  - assessment
  - task graph
  - checklist
  - linked runs
  - branch / PR metadata
- Make graph node execution mapping complete.
- Keep checklist completion evidence-backed.
- Make work item run/resume/retry behavior predictable.
- Finish dashboard surfaces for:
  - inbox
  - work board
  - work item detail
  - linked runs
  - checklist evidence
- Make branch/worktree handling safe and traceable.
- Keep commit and PR generation grounded in recorded evidence.

Acceptance:

- A work item can move from intake -> assessment -> graph -> run -> branch -> PR.
- The dashboard can explain what happened without reading raw artifacts.
- Workspace features stay experimental until this loop is boring and repeatable.

## Phase D - Team Control Plane

Goal: make the workspace usable for senior engineers and small teams.

Tasks:

- Add role and permission surfaces that are explicit, not implicit.
- Strengthen audit export and audit browsing.
- Add analytics for throughput, failure modes, approval lag, and retry cost.
- Add queue control surfaces that are safe for operators.
- Improve project registry and per-project policy handling.
- Keep local embedded mode and server mode clearly separated.

Acceptance:

- Teams can answer who did what, when, and why.
- Operators can control queue behavior without using hidden state.
- Audit and export paths are useful for reviews and incident response.

## Phase E - External Task Intake And Auto-Triage

Goal: turn Jira, Trello, GitHub, and CI signals into first-class work items.

Tasks:

- Add ingestion for external task sources.
- Normalize incoming issues into the work item model.
- Deduplicate and map external identities to workspace records.
- Auto-assess incoming tasks before execution.
- Sync status back to the source system.
- Keep manual approval at the edges where it matters.

Acceptance:

- An external task becomes a tracked work item with traceable provenance.
- Status changes round-trip cleanly.
- Auto-triage reduces manual sorting without inventing state.

## Phase F - Scale Cost, Reliability, and Governance

Goal: keep the product economical and controlled as usage grows.

Tasks:

- Add tighter token budgets and budget reporting.
- Cache project intelligence more aggressively.
- Use summary-first artifact replay by default.
- Make retention and cleanup policies explicit.
- Add observability for queue health, replay cost, and provider spend.
- Harden permissions, audit, and export paths for larger teams.

Acceptance:

- Common low-risk tasks stay cheap.
- Cost growth is measurable and explainable.
- Larger teams can adopt the system without losing control of access or history.

## Not Now

- Rewriting the system to Rust.
- Fully autonomous merge without approval.
- General-purpose multi-agent autonomy before workspace invariants are stable.
- Broad connector expansion before the workspace intake model is boringly reliable.
