# Current Project Tasks

Last updated: 2026-05-03

> **Note:** This file tracks active and immediately upcoming work for the AI Software Workspace. Completed phases (W0-W12) have been removed from this file to reduce clutter. Refer to `tasks/roadmap.md` for the overarching project direction and completed history.

## Active Milestone: Phase W13 - Evidence Checklist & Task Graphs (Draft)

- [ ] Add dynamic task graph generation based on deterministic task assessment rules.
- [ ] Implement evidence validation logic (verify file existence, tests passing, run artifacts).
- [ ] Prevent Work Items from passing required checklist items without concrete evidence.
- [ ] Implement UI for visualizing the Task Graph and Evidence Checklist in the Dashboard Work Item Detail view.

## Upcoming Milestones

### Phase W14 - Advanced PR Automation & Multi-Branch Orchestration
- [ ] Enhance `ai work pr` to fully automate AI-driven PR merging logic safely.
- [ ] Build GitHub App integration for continuous webhook ingestion.
- [ ] Improve CI Watch to support fully autonomous `ai work ci fix` loops with configurable budget/retry limits.

### Refactoring & Technical Debt
- [ ] Review and consolidate the dashboard bundle (Chunking) to reduce load size.
- [ ] Expand E2E Smoke Tests coverage to newly added Workspace API endpoints.
