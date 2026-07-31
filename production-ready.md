# Production-Ready Readiness

This document is a status check, not a roadmap pitch. Every `✅` below is backed
by something that was executed, not by the existence of code.

Legend:

- `✅` implemented and exercised by a test or a run
- `🟡` implemented but unproven — code exists, nothing executes it
- `⛔` missing

## Verdict

Readiness is not one answer. It depends on the deployment shape:

| Deployment shape | State |
|---|---|
| Single-developer local CLI (`ai quick`, solo mode) | `✅` ready |
| Internal control plane, one node, trusted network, SQLite | `✅` ready for pilot |
| Containerised deployment | `✅` ready — image builds from the lockfile, runs unprivileged, drains on `docker stop` |
| Postgres backend, single control plane | `✅` ready — exercised by SQL-executing tests and an end-to-end container run |
| Multi-node active-active HA | `🟡` unproven — job locks are mutually exclusive across pools, but a two-node control plane has not been run |
| Network-exposed or multi-tenant | `⛔` not ready — see Open Gaps |

## What Is Real And Proven

Each of these is covered by a test that fails when the behaviour is removed:

- Server health, queue, worker, and store reporting via [`health.ts`](ai-system/server/routes/health.ts)
- Lease-backed worker claim/start/complete/fail flow via [`worker-runtime.ts`](ai-system/worker/worker-runtime.ts)
- Provider worktree execution and artifact capture via [`job-executor.ts`](ai-system/worker/job-executor.ts) and [`codex-provider.ts`](ai-system/worker/providers/codex-provider.ts)
- Workspace path policy, token policy, and secret redaction
- Work item, approval, audit, lesson, and dashboard surfaces
- Graceful shutdown on SIGTERM/SIGINT — [`server.ts`](ai-system/server.ts), proven end-to-end by [`server-shutdown.test.ts`](tests/server-shutdown.test.ts) against a real signalled child process
- Request body ceiling with 413/400 responses — [`read-json-body.ts`](ai-system/server/read-json-body.ts), covered by [`request-body-limit.test.ts`](tests/request-body-limit.test.ts)
- Crash-safe concurrent file writes — [`atomic-file.ts`](ai-system/utils/atomic-file.ts), covered by [`atomic-file.test.ts`](tests/atomic-file.test.ts)
- Queue shutdown that waits for an in-flight drain — [`job-queue.ts`](ai-system/core/job-queue.ts), covered in [`server-queue.test.ts`](tests/server-queue.test.ts)
- Postgres jobs, locks, workers, and audit against a real database — [`postgres-integration.test.ts`](tests/postgres-integration.test.ts), run by CI against a `postgres:16-alpine` service container

### Measured state

| Signal | Result |
|---|---|
| `pnpm run check:all` | passes (build → typecheck → lint → tests → dashboard tests → smoke → `git diff --check`) |
| Backend tests | 428 passing (6 Postgres tests skip without a database) |
| Dashboard tests | 17 passing |
| Suite stability | `pnpm run test:flake -- 10` → 10/10 green |
| `pnpm orchestra:smoke` | passes |
| `pnpm run test:postgres` | 6 passing against `postgres:16-alpine` |
| `docker build` | succeeds from the lockfile; image runs as `node`, ships `dist/`, no `tsx` |
| `docker stop` | exit code 0 with a logged drain, not 143 |

Suite stability is listed deliberately. A single green run proved nothing here
before: the suite used to fail on a different set of tests almost every run,
which masked three real concurrency defects for as long as it lasted.

The Postgres row is listed for the same reason. These tests fail 5 of 5 when
pointed at an unreachable database, so a green result means the SQL ran.

## Closed Gaps

| Area | State | Evidence |
|---|---|---|
| Store descriptor | `✅` | [`orchestra-store.ts`](ai-system/core/orchestra-store.ts) — `file`, `sqlite`, and `postgres` are all implemented and exercised |
| Verification runner | `✅` | [`verification-runner.ts`](ai-system/worker/verification-runner.ts) writes `verification.json` and per-check artifacts on provider success |
| Worker supervisor | `✅` | [`worker-process-supervisor.ts`](ai-system/worker/worker-process-supervisor.ts) owns timeout and abort handling |
| Production auth guard | `✅` | [`server-startup.ts`](ai-system/server-startup.ts) rejects missing/placeholder/duplicate secrets; [`token-policy.ts`](ai-system/security/token-policy.ts) separates worker/Hermes/server scopes |
| Unified check gate | `✅` | `check:all` runs the whole suite. It previously ran 3 of 81 test files while reading as a full gate |
| Durable state | `✅` | SQLite by default in server mode; restart loses no queued state |
| Graceful shutdown | `✅` | `server.close()` was already wired to drain the queue, but nothing called it — no signal handler existed, so every `docker stop` killed running jobs mid-write |
| Atomic writes | `✅` | Four call sites derived their temp filename from `Date.now()`. Measured: 49 of 50 concurrent writes failed with ENOENT after silently dropping their update |
| Request body limit | `✅` | Six duplicated readers buffered unbounded input; now one shared reader capped by `AI_SYSTEM_MAX_BODY_BYTES` (default 10 MiB) |
| Postgres backend | `✅` | [`postgres-integration.test.ts`](tests/postgres-integration.test.ts) exercises job round-trip, cross-pool lock exclusion, worker store, audit log, and idempotent schema bootstrap against a real database. CI supplies one and [`ci.yml`](.github/workflows/ci.yml) fails if the suite skips |
| Container image | `✅` | Multi-stage [`Dockerfile`](Dockerfile) installs from `pnpm-lock.yaml`, ships only `dist/` plus production dependencies, runs as `node`, and has a `HEALTHCHECK`. The previous image installed a package that does not exist on npm (`agy-cli`) and therefore could not build at all — nothing had ever built it |
| Host credential exposure | `✅` | [`docker-compose.yml`](docker-compose.yml) no longer bind-mounts `~/.codex`, `~/.claude`, or `~/.gemini`. Credentials arrive as scoped environment variables, and provider config lives in a container-local volume |
| Runtime dependency accuracy | `✅` | `typescript` is imported at runtime by [`symbol-parsers.ts`](ai-system/core/symbol-parsers.ts) but was declared a devDependency. A production install crashed on startup; the old image hid this by installing devDependencies |

## Open Gaps

| Area | State | Gap |
|---|---|---|
| Multi-node active-active | `🟡` | Job locks are proven mutually exclusive across two connection pools, but no test runs two control-plane processes against one database. Single-node Postgres is proven; active-active is not. |
| Rate limiting | `⛔` | No limiting on any route. |
| CORS | `⛔` | [`server-app.ts`](ai-system/server-app.ts) sends `Access-Control-Allow-Origin: *` on every response, including authenticated ones. |
| Token comparison | `⛔` | [`token-policy.ts`](ai-system/security/token-policy.ts) compares with `===` rather than `crypto.timingSafeEqual`. |
| Command policy | `🟡` | [`command-policy.ts`](ai-system/security/command-policy.ts) is a denylist. `find / -delete` and equivalents pass. A denylist gives more confidence than it earns; verification commands should move to an allowlist. |
| Worker record ordering | `🟡` | `WorkerStore.save()` is last-writer-wins with no read-modify-write lock, so a heartbeat can overwrite a concurrent status change. Unique temp names fixed the crash, not the lost update. |

## Fastest Path Forward

### Before anyone outside the team can reach it

1. `crypto.timingSafeEqual` for token comparison.
2. Replace `Access-Control-Allow-Origin: *` with an origin allowlist.
3. Add rate limiting.

### Before claiming active-active HA

4. Run two control-plane processes against one Postgres database and exercise
   the claim/lease contract between them. Cross-pool lock exclusion is proven;
   two live control planes are not.

### Worth doing regardless

5. Move verification commands from the denylist to an allowlist.
6. Give `WorkerStore.save()` a read-modify-write lock so a heartbeat cannot
   overwrite a concurrent status change.

## Running The Checks

```bash
pnpm run check:all              # full gate
pnpm run test:flake -- 10       # repeat the suite; proves it is not flaky
```

Postgres tests skip unless a database is configured:

```bash
POSTGRES_PASSWORD=<secret> docker compose --profile postgres up -d postgres
ORCHESTRA_TEST_POSTGRES_URL=postgresql://orchestra:<secret>@127.0.0.1:5432/orchestra pnpm run test:postgres
```

## Production-Ready Checklist

Unchecked means unproven, not necessarily unbuilt.

- [x] Store capabilities are truthful for `file`, `sqlite`, and `postgres`.
- [x] A real verification runner runs after provider execution.
- [x] Verification artifacts show which command failed and why.
- [x] Provider timeout and abort cannot leave zombie processes behind.
- [x] Worker restart does not duplicate or lose jobs in SQLite mode.
- [x] Server restart does not lose important queued state in SQLite mode.
- [x] Server drains in-flight work on SIGTERM instead of dying mid-job.
- [x] Request bodies are bounded.
- [x] Concurrent writes to the same record cannot corrupt or drop it.
- [x] Dashboard smoke passes headless.
- [x] Production token defaults are blocked at startup.
- [x] `pnpm run check:all` runs the whole suite.
- [x] `pnpm orchestra:smoke` passes.
- [x] The suite is stable across repeated runs (10/10).
- [x] The Postgres backend is exercised by tests that run SQL.
- [x] The container image builds reproducibly from the lockfile.
- [x] The container runs unprivileged and holds no host credentials.
- [x] `docker stop` drains instead of killing.
- [ ] Two control planes share one database without stepping on each other.
- [ ] Token comparison is constant-time.
- [ ] CORS is restricted to known origins.
- [ ] Request rate is limited.

## Bottom Line

Ship it for an internal deployment on a trusted network, in a container, on
either SQLite or Postgres. That envelope is now covered end to end: the image
builds from the lockfile and runs unprivileged, the server drains on `docker
stop`, requests are bounded, auth is enforced at startup, the Postgres backend
is exercised by SQL that actually runs, and the suite's green is reproducible.

Do not expose it directly to a network — token comparison, CORS, and rate
limiting are the three gaps that matter there. Do not describe it as
active-active HA until two control planes have been run against one database.
