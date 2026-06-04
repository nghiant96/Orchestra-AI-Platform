# Production-Ready Readiness

This document is a status check, not a roadmap pitch.

Legend:

- `✅` implemented
- `🟡` partial
- `⛔` missing

## Verdict

`Not production-ready yet.`

The platform has a strong control-plane and worker foundation, but a few blocking pieces are still missing before it can be called production-ready with confidence:

- verification artifact detail
- production token hardening
- durable state beyond the file-backed queue

## What Is Already Real

These are in place and should be preserved:

- Server health, queue, worker, and store reporting via [`ai-system/server/routes/health.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/server/routes/health.ts)
- Lease-backed worker claim/start/complete/fail flow via [`ai-system/worker/worker-runtime.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/worker-runtime.ts)
- Provider worktree execution and artifact capture via [`ai-system/worker/job-executor.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/job-executor.ts) and [`ai-system/worker/providers/codex-provider.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/providers/codex-provider.ts)
- Workspace path policy, token policy, command policy, and redaction foundations
- Work item, approval, audit, lesson, and dashboard surfaces
- A working `orchestra:smoke` script in [`package.json`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/package.json)

This is enough to call the system a solid alpha/preview foundation. It is not enough to call it production-ready yet.

## Blocking Gaps

| Area | State | Evidence | Gap |
|---|---|---|---|
| Store descriptor | `✅` implemented | [`ai-system/core/orchestra-store.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/orchestra-store.ts) | The descriptor now tells the truth: `file` is implemented, `sqlite` and `postgres` are reserved with explicit warnings. |
| Verification runner | `✅` implemented | [`ai-system/worker/verification-runner.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/verification-runner.ts) | Provider success now runs configured verification commands and writes `verification.json` plus per-check artifacts. |
| Worker supervisor | `✅` implemented | [`ai-system/worker/worker-process-supervisor.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/worker/worker-process-supervisor.ts) | Provider command execution now goes through a dedicated supervisor seam that owns timeout and abort handling. |
| Production auth guard | `🟡` partial | [`ai-system/server-startup.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/server-startup.ts) and [`package.json`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/package.json) | Server startup now rejects missing and placeholder tokens, but the rest of the auth model still needs full production hardening. |
| Dashboard smoke | `✅` implemented | [`package.json`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/package.json) and [`tests/dashboard-smoke.test.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/tests/dashboard-smoke.test.ts) | A headless dashboard smoke command exists and is part of the project readiness checks. |
| Unified check gate | `✅` implemented | [`package.json`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/package.json) | `check:all` now exists and chains the main readiness checks. |
| Durable state | `⛔` missing | [`ai-system/core/store-mode.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/store-mode.ts) and [`ai-system/core/orchestra-store.ts`](/Users/trungnghianguyen/Documents/AI-CODING-SYSTEM/ai-system/core/orchestra-store.ts) | `ORCHESTRA_STORE` accepts `sqlite` and `postgres`, but the platform still behaves as file-backed in practice. |

## Fastest Path To Production-Ready

If the goal is speed, do this in order:

### P0

1. Tighten production token hardening so startup and auth defaults cannot be misconfigured in server mode.
2. Make verification artifacts show exactly which command failed and why.
3. Implement a durable store path so worker restart and server restart do not depend on the file-backed queue.

### P1

4. Keep the headless dashboard smoke path and `check:all` gate green as regressions are fixed.

### P2

5. Extend the durable backend to cover the smallest safe SQLite-backed job repository if file-backed state becomes the bottleneck.

## Production-Ready Checklist

This is the minimum bar I would use before calling the project production-ready:

- [x] Store capabilities are truthful for every mode.
- [x] A real verification runner runs after provider execution.
- [ ] Verification artifacts show which command failed and why.
- [x] Provider timeout and abort cannot leave zombie processes behind.
- [ ] Worker restart does not duplicate or lose jobs.
- [ ] Server restart does not lose important queued state.
- [x] Dashboard smoke passes headless.
- [x] Production token defaults are blocked at startup.
- [x] `pnpm run check:all` exists.
- [x] `pnpm orchestra:smoke` passes.

## Bottom Line

The project is close in architecture, but not yet in operating readiness.

The fastest credible path to production-ready is:

1. tighten production auth
2. improve verification artifact detail
3. finish durable state
4. keep smoke and gate checks green

Once those are in place, the rest becomes operational hardening rather than a fundamental readiness gap.
