# Implementation Checklist

Last updated: 2026-05-03

This file turns the roadmap into a step-by-step execution order.

Use this loop for every phase:

1. Lock the phase goal in one sentence.
2. Read the current code/docs that own the contract.
3. Change the smallest safe surface.
4. Verify the changed behavior immediately.
5. Fix the root cause if verification fails.
6. Update `tasks/todo.md`.
7. Record lessons in `tasks/lessons.md` if the phase exposed a new rule.
8. Move to the next phase only when the exit criteria are actually met.

## Phase A - Stabilize v0.9

Goal: a fresh clone can run, understand, and verify the product without source-code spelunking.

### A1. Normalize startup experience

- [ ] Inspect the current startup scripts in root `package.json`, dashboard `package.json`, and server entrypoints.
- [ ] Verify the required env vars for server mode, dashboard proxy, and local dev mode.
- [ ] Update `.env.example` so it contains only the variables a new user must know.
- [ ] Make sure the root `local:dev` flow works from a clean shell with the repo-root `.env`.
- [ ] Make sure the server fails fast and says why when `AI_SYSTEM_SERVER_TOKEN` is missing.

After this step:

- Run the documented startup commands from a clean shell.
- Confirm there is no hidden env dependency.

### A2. Align docs with runtime behavior

- [ ] Read `README.md`, `docs/SERVER.md`, `docs/SECURITY.md`, and `docs/OPERATIONS.md`.
- [ ] Update any place that still describes an old host, auth, or preview/shipped contract.
- [ ] Make sure docs say which features are real now and which are roadmap-only.
- [ ] Keep terminology consistent: server mode, local embedded mode, workspace preview, work item, job, run.
- [ ] Remove any claim that the code does not actually satisfy.

After this step:

- Re-run the documented commands and verify docs still match reality.
- If a doc and code disagree, fix code or docs immediately, not later.

### A3. Refresh demo and proof

- [ ] Pick one low-risk task that is simple enough to finish end-to-end.
- [ ] Capture the full path:
  - create
  - assess
  - run
  - check dashboard
  - inspect artifact/result
- [ ] Record what file or job proves the demo worked.
- [ ] Add the demo path to docs or release notes.
- [ ] Avoid demo tasks that require branching into many unrelated modules.

After this step:

- You should be able to point to one concrete demo run as evidence.

### A4. Keep CI green on the release path

- [ ] Run `pnpm test`.
- [ ] Run `pnpm run dashboard:build`.
- [ ] Check the CI workflow commands against local scripts.
- [ ] Fix script-level issues before chasing application logic.
- [ ] Make sure dashboard build and root test do not depend on unstated local state.

After this step:

- CI commands should be reproducible locally.
- Any failure at this stage is a release blocker, not a backlog item.

Exit criteria:

- New clone works without guesswork.
- Docs match code.
- Demo is real.
- CI release path is green.

## Phase B - Make the Core Loop Excellent

Goal: lower retry cost and make failures explain themselves.

### B1. Tighten run outputs

- [ ] Read the run executor, retry hint, JSON parsing, and result shaping code paths.
- [ ] Identify failure classes that currently collapse into one generic message.
- [ ] Split missing-file, tool-crash, partial-generation, and schema-failure cases.
- [ ] Make retry hints short and actionable.
- [ ] Keep summaries grounded in artifact data, not guesses.

After this step:

- A failed run should tell you what class of failure happened.

### B2. Improve tool checks

- [ ] Review changed-file scoping logic for lint, test, and typecheck.
- [ ] Keep scoped checks narrow when possible.
- [ ] Add fallback behavior when scoping cannot cover the whole change.
- [ ] Turn tool output into structured issues when possible.
- [ ] Make “check did not run” distinct from “check failed”.

After this step:

- Tool check failures should point to the actual command and reason.

### B3. Improve context selection

- [ ] Review the candidate ranking and budget trimming path.
- [ ] Add or preserve reasons for file inclusion/exclusion.
- [ ] Keep project intelligence reuse summary-first by default.
- [ ] Avoid replaying full history when a summary is enough.
- [ ] Make the context budget visible in logs or artifacts.

After this step:

- You can explain why the model saw the files it saw.

### B4. Budget repair loops

- [ ] Put explicit limits on retry count per failure class.
- [ ] Put explicit limits on escalation to stronger models.
- [ ] Record why a second pass was allowed.
- [ ] Stop repair loops when the same failure class repeats.
- [ ] Preserve the cheapest path for low-risk tasks.

After this step:

- Simple tasks stay cheap.
- Expensive retries are justified and traceable.

Exit criteria:

- Retry count drops.
- Failure explanations improve.
- Low-risk tasks remain low-cost.

## Phase C - Finish Workspace Engine v1 Preview

Goal: work items become durable execution objects, not wrapped tasks.

### C1. Lock the work item contract

- [ ] Inspect the current work item JSON shape and store layout.
- [ ] Decide which fields are source-of-truth in `work-item.json`.
- [ ] Keep `assessment.json`, `task-graph.json`, `checklist.json`, and `runs.json` as separate durable files.
- [ ] Ensure any shared field has one canonical owner.
- [ ] Keep normalization strict for missing fields and legacy records.

After this step:

- The model should be obvious from the files on disk.

### C2. Complete graph execution mapping

- [ ] Map graph nodes to orchestrator requests.
- [ ] Make node status reconciliation deterministic.
- [ ] Attach run IDs to nodes and nodes back to runs.
- [ ] Attach checklist evidence from node/job results.
- [ ] Keep resume and retry flows node-aware.

After this step:

- A work item can show which node ran, what it did, and what evidence it produced.

### C3. Finish workspace dashboard surfaces

- [ ] Make inbox and work board useful for triage.
- [ ] Make work item detail show graph, checklist, linked runs, and evidence.
- [ ] Keep job/run views available as supporting views.
- [ ] Make the UI explain state without requiring artifact inspection.
- [ ] Avoid showing incomplete or guessed data as final state.

After this step:

- The dashboard should answer “what is this work item doing right now?”

### C4. Finish branch and PR handoff

- [ ] Keep branch creation safe and traceable.
- [ ] Keep commit generation grounded in evidence.
- [ ] Keep PR body grounded in recorded facts.
- [ ] Keep approval boundaries explicit before branch/commit/PR actions.
- [ ] Keep handoff repeatable on more than one repo.

After this step:

- A work item can move from intake to branch/PR with evidence.

Exit criteria:

- Work item lifecycle is durable.
- Dashboard explains the state.
- Handoff is grounded in evidence.

## Phase D - Team Control Plane

Goal: make the workspace safe and visible for operators and senior engineers.

### D1. Add explicit role and permission surfaces

- [ ] Review auth and permission flow in server mode and local embedded mode.
- [ ] Keep server auth strict and explicit.
- [ ] Keep local embedded behavior ergonomic without widening server mode.
- [ ] Make operator-only actions obvious in API and dashboard.
- [ ] Keep audit actor metadata separate from auth identity.

After this step:

- It should be clear who can do what and why.

### D2. Strengthen audit and export

- [ ] Make audit browsing easier.
- [ ] Add export paths for team review and incident response.
- [ ] Record approvals, queue control, branch, and PR actions.
- [ ] Keep exported records useful without post-processing.
- [ ] Keep audit/event shape stable across releases.

After this step:

- A team can reconstruct important actions from audit data.

### D3. Add operational analytics

- [ ] Add throughput and failure-rate views.
- [ ] Add approval lag and retry-cost views.
- [ ] Add queue health and retention views.
- [ ] Keep analytics bounded and cheap.
- [ ] Do not add metrics that cannot drive a decision.

After this step:

- Operators can see where the system spends time and fails.

### D4. Harden queue control

- [ ] Make pause/resume/cancel results unambiguous.
- [ ] Keep queue actions safe under concurrent load.
- [ ] Avoid hidden state transitions.
- [ ] Make queue control visible in the dashboard.

After this step:

- Queue control should be safe enough for real operators.

Exit criteria:

- Teams can answer who did what, when, and why.
- Queue control is safe and visible.

## Phase E - External Task Intake And Auto-Triage

Goal: turn Jira/Trello/GitHub/CI signals into first-class work items.

### E1. Define intake adapters

- [ ] Define a normalized external task shape.
- [ ] Map source, identity, and deduplication keys.
- [ ] Preserve provenance in stored metadata.
- [ ] Keep source-specific parsing behind adapters, not in core workflow code.

After this step:

- An incoming task should have a stable internal identity.

### E2. Build auto-triage

- [ ] Assess incoming tasks before execution.
- [ ] Route low-risk tasks to the cheaper path.
- [ ] Flag tasks that need human approval early.
- [ ] Keep triage deterministic unless deeper reasoning is justified.
- [ ] Avoid over-modeling tasks that are obviously simple.

After this step:

- Intake should reduce manual sorting, not add noise.

### E3. Sync status back

- [ ] Update the source system as work progresses.
- [ ] Keep round-trip changes traceable.
- [ ] Avoid inventing external states the source does not support.
- [ ] Make failures to sync visible and actionable.

After this step:

- External systems should reflect the workspace state cleanly.

Exit criteria:

- External tasks become durable work items with provenance.
- Status round-trips cleanly.

## Phase F - Scale Cost, Reliability, and Governance

Goal: keep the platform economical as usage grows.

### F1. Tighten cost policy

- [ ] Add explicit budgets for classification, implementation, review, and repair.
- [ ] Report token usage by stage and provider.
- [ ] Keep summary-first replay as the default.
- [ ] Make expensive paths require a reason.

After this step:

- You can explain where token spend goes.

### F2. Improve caching and retention

- [ ] Cache project intelligence more aggressively.
- [ ] Keep retention and cleanup policies explicit.
- [ ] Avoid recomputing stable context repeatedly.
- [ ] Keep artifact and queue cleanup bounded.

After this step:

- Stable data should stop costing repeated compute.

### F3. Harden governance

- [ ] Keep permissions, audit, and export paths robust for larger teams.
- [ ] Ensure server mode stays strict.
- [ ] Keep local mode easy to use.
- [ ] Avoid mixing operator control with user convenience.

After this step:

- Larger teams can use the system without losing control.

Exit criteria:

- Common tasks stay cheap.
- Cost growth is measurable.
- Governance remains strong at scale.

## Phase Handoff Rules

- Do not start the next phase until the current phase exit criteria are met.
- Do not add unrelated refactors while closing a phase unless they are blocking the exit criteria.
- If a test fails, fix the cause immediately or stop and replan.
- If docs and code disagree, fix the contract before expanding scope.
- If a task is low-risk but still fails, treat that as a system bug, not a user mistake.

