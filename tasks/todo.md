# Current Project Tasks

Last updated: 2026-06-12

## Task: Implement v0.13 Dashboard Evidence Viewer, v0.14 Durable Team Mode, and v0.15 Integration Intelligence

- [x] Add manifest-backed job detail evidence viewing in the dashboard.
- [x] Add Context Pack, Diff, Guards, Verification, and Artifact evidence sections.
- [x] Add durable store groundwork with repository contracts, sqlite audit persistence, and migration runners.
- [x] Add integration intelligence scanning and write `integration/integration-check.json`.
- [x] Update roadmap completion state for v0.13-v0.15.
- [x] Run focused tests, typecheck, lint, `git diff --check`, and `check:all`.

Review result:

- v0.13 dashboard evidence viewer is wired to manifest-backed artifacts and job detail tabs.
- v0.14 durable team mode now has explicit repository contracts, sqlite audit persistence, and legacy migration support.
- v0.15 integration intelligence now scans frontend/backend endpoints, writes a report, and stays warning-only by default.
- Verification passed with focused tests, root typecheck, dashboard typecheck, full `pnpm run check:all`, and `git diff --check`.
