# Production-Ready Readiness

This document is a status check, not a roadmap pitch.

Legend:

- `✅` implemented
- `🟡` partial
- `⛔` missing

## Verdict

`Ready for the initial production release envelope.`

The platform now has the main production hardening pieces in place. The remaining choice is about future scale/HA tuning, not the initial release envelope:

- verify the Postgres-backed HA path under the target deployment topology

## What Is Already Real

These are in place and should be preserved:

- Server health, queue, worker, and store reporting via [`ai-system/server/routes/health.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/server/routes/health.ts)
- Lease-backed worker claim/start/complete/fail flow via [`ai-system/worker/worker-runtime.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/worker-runtime.ts)
- Provider worktree execution and artifact capture via [`ai-system/worker/job-executor.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/job-executor.ts) and [`ai-system/worker/providers/codex-provider.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/providers/codex-provider.ts)
- Workspace path policy, token policy, command policy, and redaction foundations
- Work item, approval, audit, lesson, and dashboard surfaces
- A working `orchestra:smoke` script in [`package.json`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/package.json)

This is enough to call the system ready for the initial release envelope, and Postgres is now the implemented HA/scale path for future multi-node or higher write-concurrency needs.

## Blocking Gaps

| Area | State | Evidence | Gap |
|---|---|---|---|
| Store descriptor | `✅` implemented | [`ai-system/core/orchestra-store.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/orchestra-store.ts) | The descriptor now tells the truth: `file` is implemented, `sqlite` is implemented as a durable queue backend, and `postgres` is implemented for HA/scale. |
| Verification runner | `✅` implemented | [`ai-system/worker/verification-runner.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/verification-runner.ts) | Provider success now runs configured verification commands and writes `verification.json` plus per-check JSON/log artifacts that include failure details. |
| Worker supervisor | `✅` implemented | [`ai-system/worker/worker-process-supervisor.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/worker-process-supervisor.ts) | Provider command execution now goes through a dedicated supervisor seam that owns timeout and abort handling. |
| Production auth guard | `✅` implemented | [`ai-system/server-startup.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/server-startup.ts), [`ai-system/server-app.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/server-app.ts), and [`ai-system/security/token-policy.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/security/token-policy.ts) | Server startup now rejects missing tokens, placeholder tokens, and duplicate role secrets, and route auth keeps worker/Hermes/server scopes separated. |
| Dashboard smoke | `✅` implemented | [`package.json`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/package.json) and [`tests/dashboard-smoke.test.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/tests/dashboard-smoke.test.ts) | A headless dashboard smoke command exists and is part of the project readiness checks. |
| Unified check gate | `✅` implemented | [`package.json`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/package.json) | `check:all` now exists and chains the main readiness checks. |
| Durable state | `✅` implemented | [`ai-system/core/store-mode.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/store-mode.ts), [`ai-system/core/orchestra-store.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/orchestra-store.ts), and [`ai-system/core/job-queue.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/job-queue.ts) | Server mode now defaults to SQLite durability, while explicit `ORCHESTRA_STORE=postgres` switches the durable path to Postgres for HA/scale-large deployments. |

## Fastest Path To Production-Ready

If the goal is speed, do this in order:

### P0

1. Verify the Postgres deployment target and connection settings for the next scale step.

### P1

2. Keep the headless dashboard smoke path and `check:all` gate green as regressions are fixed.

### P2

3. Keep the durable backend healthy under the chosen production topology and write-concurrency target.

## Production-Ready Checklist

This is the minimum bar I would use before calling the project production-ready:

- [x] Store capabilities are truthful for every mode.
- [x] A real verification runner runs after provider execution.
- [x] Verification artifacts show which command failed and why.
- [x] Provider timeout and abort cannot leave zombie processes behind.
- [x] Worker restart does not duplicate or lose jobs in SQLite mode.
- [x] Server restart does not lose important queued state in SQLite mode.
- [x] Dashboard smoke passes headless.
- [x] Production token defaults are blocked at startup.
- [x] `pnpm run check:all` exists.
- [x] `pnpm orchestra:smoke` passes.

## Bottom Line

The project is ready to ship for the current single-node control-plane envelope.

SQLite is sufficient for the initial official release if the deployment stays on one durable server/control plane and worker topology. Postgres is already implemented for the HA/scale-large path, so the remaining release decision is deployment shape, not code availability.

Keep smoke and gate checks green, and treat Postgres as the next scale milestone rather than a blocker for the first production release.

## HA / Scale Large

`Implemented for the HA/scale-large path; verify the target deployment topology before release.`

For the HA/scale-large envelope, Postgres is now the active storage path. The current SQLite-backed setup is acceptable for the initial release envelope, but it is not the final answer for multi-node HA or active-active control planes.

Use this rule of thumb:

- single control-plane node with workers: SQLite is enough
- multi-node HA or active-active control plane: add Postgres before release
- higher write concurrency than SQLite should carry: add Postgres before release
