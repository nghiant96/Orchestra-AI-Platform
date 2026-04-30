# Internal Release Notes - v0.9 Release Candidate

Date: 2026-04-30

This release candidate (v0.9) marks the completion of the core operational roadmap (v0.2-v0.8). The system has evolved from a CLI prototype into a multi-project automation platform with a policy-driven execution engine and a productized dashboard.

## Completed Capabilities

### v0.2: Green Operations Baseline
- **Stable Queue Lifecycle:** Reliable enqueue, cancel, retry, and resume operations.
- **Structured Dashboard Sections:** Organized Job Detail views for Plan, Files, Checks, Review, and Artifacts.
- **Quality Gates:** Area-specific checks for system, dashboard, and config changes.
- **Actionable Failures:** Clear failure classification and retry recommendations.

### v0.2.5: Dashboard Polish
- **Component Decomposition:** Job Detail and Config View refactored into stable, maintainable section components.
- **Failure Analysis:** New FailurePanel surfacing failure class, retryability, and retry hint stages.
- **Project Health:** Dashboard panel summarizing the latest baseline gate status (typecheck, lint, test).

### v0.3: Task Contracts
- **Contract Model:** Generic `TaskContract` layer for explicit requirement tracking.
- **Automatic Extraction:** Deterministic extraction of UI layout, API preservation, risky-test, and security/dependency requirements from task text.
- **Agent Integration:** Contracts are now injected into Generator, Reviewer, and Fixer prompts.
- **Visibility:** Pass/fail status and suggested fixes for contracts surfaced in the dashboard.

### v0.4: Policy-Based Automation
- **Risk Scoring:** Automated classification of tasks as low, medium, high, or blocked based on paths, diff size, and sensitivity.
- **Policy Actions:** Auto-run for low-risk tasks; pause-after-plan for medium; pause-after-generate and strict review for high; manual-only for blocked.
- **Explanations:** Policy decisions and matched risk signals are clearly explained in the UI.

### v0.5: Productized Dashboard
- **Activity Feed:** Live status tracking with wrapped, count-aware filters.
- **Analytics:** Provider performance metrics including success rates, duration trends, and costs.
- **Lessons UI:** Surfacing project lessons and failure-driven proposals directly in the dashboard.

### v0.6: Multi-Project & Team Readiness
- **Project Registry:** Centralized management of multiple repositories.
- **Role-Based Access:** Support for Viewer, Operator, and Admin roles with corresponding API permissions.
- **Audit Log:** Persistent event log for job lifecycle, approvals, writes, and config changes.
- **Isolation:** Strict CWD-scoped isolation for jobs, artifacts, and configuration.

### v0.7: Learning System
- **Lessons Integration:** `tasks/lessons.md` acts as the project's long-term memory.
- **Proactive Learning:** Automated lesson proposals derived from repeated failure classes.
- **Context Injection:** Relevant lessons are automatically injected into the planning phase.

### v0.8: Stabilization & Technical Debt
- **Component Cleanup:** Removed stale roadmap docs and unused dashboard code.
- **API Documentation:** Comprehensive operations runbook and API guide in `docs/OPERATIONS.md`.
- **Refactoring:** Normalized failure classes and decoupled server logic from CLI handlers.

## Migration Notes

### Configuration
- **Project Config:** Ensure repositories have a `.ai-system.json` for provider and tool settings. Legacy root-level review docs are no longer supported.
- **Environment:** Secrets and host-specific URLs should reside in `.env`.

### Server Operations
- **Workdirs:** The server now requires `AI_SYSTEM_ALLOWED_WORKDIRS` (absolute paths) to enforce project isolation.
- **Auth Token:** `AI_SYSTEM_SERVER_TOKEN` is mandatory for server-mode write operations.

### Artifacts
- **Structure:** Run artifacts now use a stable stage-based naming convention (e.g., `01-plan`, `iteration-1`).
- **Compatibility:** Older v0.1 artifacts may not be fully compatible with the v0.9 `ai runs` browser.

## Known Limitations

- **Dashboard Smoke:** No automated browser-level smoke tests for the dashboard UI yet.
- **Identity Providers:** External IDP integration (OIDC/SAML) is not implemented; the system uses a shared bearer token.
- **Schema Versioning:** Artifact and config schema versioning is planned for v1.0.

## Verification Checklist

Before final v0.9 release, the following gates must be green:
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm test`
- [ ] `pnpm run dashboard:build`
- [ ] `pnpm --dir dashboard test`
- [ ] `pnpm audit --audit-level high`
- [ ] `git diff --check`
