# Current Project Tasks

Last updated: 2026-06-12

## Task: Align release-readiness wording with current runtime state

- [x] Tone down the production-readiness note so it matches the current single-node pilot posture.
- [x] Verify the repo docs and script references remain consistent after the wording update.
- [x] Re-run a lightweight diff check and record the result.

Review goal:

- Keep the docs truthful and aligned with the implemented control-plane, worker, and storage behavior.
- Avoid overclaiming production readiness when the repo still describes preview and alpha surfaces.

Review result:

- `production-ready.md` now consistently describes the repo as ready for an initial internal pilot instead of a general production release, which matches the surrounding preview/alpha language.
- `README.md` now includes a compact recommended verification loop, and `.env.example` now shows explicit solo local, server + dashboard, and server + worker modes.
- The workspace/package scripts already align, and `git diff --check` passed after the wording update.

## Task: Close the review-driven dogfood follow-up

- [x] Switch CI installs back to `--frozen-lockfile` now that the lockfile is stable.
- [x] Bump the package/release version to reflect the current alpha state.
- [x] Expose an explicit Solo Mode dirty-tree escape hatch and document it.
- [x] Add focused tests for the parser, handler, and dirty-tree Solo flow.
- [x] Re-run targeted tests, typecheck, lint, and `git diff --check`.

Review goal:

- Keep the smallest safe surface area while landing the follow-up items called out in the repo review.
- Improve dogfood reliability without turning the dirty-tree support into a separate feature branch.

Review result:

- CI now installs with `--frozen-lockfile` again, which keeps lockfile drift visible instead of papered over.
- Solo Mode now accepts `--allow-dirty` end to end, and the error message tells operators how to opt in intentionally.
- `--stash` and `--worktree` now give dirty-tree runs safer isolation modes instead of forcing every user into the same escape hatch.
- Undo, continue, and commit now emit audit events, so solo operations are traceable alongside the artifact history.
- The context builder now keeps `allowedDiffBoundary` focused on directory-level slices instead of widening to repo-level prefixes.
- The package version and docs were bumped to `0.10.0-alpha` so the repo metadata matches the current state more closely.
- Targeted CLI, runner, typecheck, lint, and repo-wide checks all passed after the change.

## Task: Surface Solo Audit History in the Dashboard

- [x] Add a dashboard hook for `/audit` and a reusable solo-audit panel.
- [x] Add a `/audit` route plus a home-screen recent-activity panel for solo `undo` / `continue` / `commit` events.
- [x] Add UI tests that prove the audit feed renders in both the home view and the audit page.
- [x] Run dashboard typecheck, dashboard tests, root lint, and `git diff --check`.
- [x] Connect solo audit history into job detail and work item detail views.

Review goal:

- Make the solo audit trail visible in the dashboard without changing the server contract.
- Keep the UI focused on the solo workflow history the review asked for: undo, continue, and commit.

Review result:

- The dashboard now polls `/audit`, filters Solo Mode events, and shows them in a reusable audit panel.
- The home screen gets a compact recent-history widget, while `/audit` exposes the fuller trail view.
- Job detail and work item detail now expose scoped audit trail tabs so the per-job history is visible where operators inspect the run.
- Smoke coverage now verifies both placements, and the dashboard typecheck, dashboard test suite, root lint, and `git diff --check` all passed.

## Task: Add Short Postgres Cutover Runbook

- [x] Create a copy-pasteable 10-minute cutover guide for Postgres releases.
- [x] Link the cutover guide from the longer operations runbook.
- [x] Keep the checklist short enough for release-day use.

Review result:

- Release operators now have a dedicated short runbook they can follow without reading the full ops guide.
- The long-form ops doc still holds the deeper migration notes and rollback checklist.

## Task: Add Postgres Deploy/Runtime and Migration Path

- [x] Add a Postgres compose profile and connection wiring for container deploys.
- [x] Add a one-shot migration command for jobs, audit events, and worker state.
- [x] Document the cutover and rollback checklist for HA/scale-large releases.
- [x] Add coverage for the legacy worker migration helper.
- [x] Re-run targeted tests, typecheck, `check:all`, and `git diff --check`.

Review result:

- The HA/scale-large path now has an explicit deploy story instead of only a code-level backend.
- Operators can start Postgres with compose, migrate legacy workspace data once, and then switch traffic with a checklist.
- Verification passed end to end, including the repo-wide gate.

## Task: Implement Postgres HA / Scale-Large Backend

- [x] Add Postgres-backed repositories for jobs, audit logs, and workers.
- [x] Route server, health, and worker flows through the store factory so `ORCHESTRA_STORE=postgres` is honored.
- [x] Expose `ORCHESTRA_POSTGRES_URL` in docs and sample env config.
- [x] Add tests for store descriptor and backend selection.
- [x] Run targeted tests, typecheck, `check:all`, and `git diff --check`.

Review result:

- Postgres is now wired in as the durable HA/scale path behind `ORCHESTRA_STORE=postgres`.
- The single-node SQLite/file paths still work unchanged for the initial release envelope.
- `pnpm run check:all` passes after the rollout, so the storage refactor is green end to end.

## Task: Document HA / Scale-Large Position

- [x] Clarify that the current release envelope is production-ready while HA/scale-large still needs Postgres.
- [x] Keep the Postgres decision explicit in the production readiness note.

Review result:

- Initial production release envelope stays green.
- HA/scale-large remains a follow-up milestone, with Postgres as the next step.

## Task: Harden Auth Configuration and Reassess Scale Path

- [x] Reject duplicate or placeholder auth tokens across server, worker, and Hermes roles at startup.
- [x] Add tests for token configuration hardening and preserve existing route auth behavior.
- [x] Reassess whether SQLite is sufficient for release or Postgres is needed for scale/HA.
- [x] Update production-ready notes with the final auth and storage decision.

Review result:

- Server startup now rejects missing, placeholder, and duplicate auth tokens across roles, which closes the main misconfiguration hole.
- SQLite is sufficient for the initial production release envelope as long as the deployment remains a single durable control-plane node; Postgres becomes necessary when we need multi-node HA or more concurrent write-heavy scaling.
- Production-ready notes now reflect the hardened auth model and the storage decision.

## Task: Close Production Readiness Gaps

- [x] Make server mode default to the durable `sqlite` store while keeping local CLI/file mode intact.
- [x] Update production-facing docs to explain the server-mode storage default.
- [x] Re-run focused tests and project checks after the store-mode change.
- [x] Refresh the production readiness note so it reflects the current runtime state and remaining scale decisions.

Review result:

- Server mode now boots into durable SQLite storage by default unless `ORCHESTRA_STORE` overrides it.
- Local CLI usage still keeps the lightweight file-backed default, so checkout workflows remain unchanged.
- Focused tests passed, `pnpm run check:all` passed, and the production-ready note now reflects the remaining auth/scale follow-up work.

## Task: Implement v0.13 Dashboard Evidence Viewer, v0.14 Durable Team Mode, and v0.15 Integration Intelligence

- [x] Add manifest-backed job detail evidence viewing in the dashboard.
- [x] Add Context Pack, Diff, Guards, Verification, and Artifact evidence sections.
- [x] Add durable store groundwork with repository contracts, sqlite audit persistence, and migration runners.
- [x] Add integration intelligence scanning and write `integration/integration-check.json`.
- [x] Update roadmap completion state for v0.13-v0.15.
- [x] Run focused tests, typecheck, lint, `git diff --check`, and `check:all`.
- [x] Document the source-checkout fallback for `ai` / `ai-system` in README and CLI reference.

Review result:

- v0.13 dashboard evidence viewer is wired to manifest-backed artifacts and job detail tabs.
- v0.14 durable team mode now has explicit repository contracts, sqlite audit persistence, and legacy migration support.
- v0.15 integration intelligence now scans frontend/backend endpoints, writes a report, and stays warning-only by default.
- Verification passed with focused tests, root typecheck, dashboard typecheck, full `pnpm run check:all`, and `git diff --check`.
- `ai` and `ai-system` now fall back to source execution when `dist/` is not present, so fresh checkouts and tests no longer require a prebuild.
