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
| Network-exposed, one team, behind a TLS proxy | `🟡` the known gaps are closed and covered by tests, but no exposed deployment has been run or penetration-tested |
| Multi-tenant | `⛔` not ready — one server token, one queue, and one config are shared by everyone who can reach the server |

**Deployment readiness is not the same as product readiness.** Everything above
answers "can this be operated safely?". It says nothing about whether the
multi-agent orchestration the project is named for actually works. That is a
separate axis with its own section below, and it is the weaker of the two.

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
| Backend tests | 464 passing (6 Postgres tests skip without a database) |
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
| Role escalation through headers | `✅` | The actor role came from the client's `X-AI-System-Role` header, so a hermes token could claim admin and write config — whose verification commands the server executes. Each token now has a ceiling ([`token-policy.ts`](ai-system/security/token-policy.ts)) that headers and role mappings cannot exceed, and hermes cannot write `/config`. Covered by [`token-role-ceiling.test.ts`](tests/token-role-ceiling.test.ts) |
| Arbitrary file read | `✅` | `GET /jobs/:id/files/content?path=../../.env` returned any file the server could read. The path is now held inside the artifact snapshot, symlinks included ([`job-service.ts`](ai-system/jobs/job-service.ts), [`job-service.test.ts`](tests/job-service.test.ts)) |
| Clean-env sandbox | `✅` | `runCommandWithRetry` re-listed its options by hand and dropped `env`, so `clean-env` passed the server's whole environment, tokens included, to verification commands. Options are now forwarded wholesale; [`tool-executor.test.ts`](tests/tool-executor.test.ts) asserts an excluded variable is absent |
| Token comparison | `✅` | Constant-time over SHA-256 digests via [`tokensMatch`](ai-system/security/token-policy.ts), used by the HTTP server and the Hermes MCP check. The timing property itself is not measured by a test |
| CORS | `✅` | `Access-Control-Allow-Origin: *` was sent on every response. Now no cross-origin grant unless the origin is listed in `AI_SYSTEM_CORS_ORIGINS`; `*` is refused at startup ([`cors-policy.ts`](ai-system/security/cors-policy.ts), [`cors-policy.test.ts`](tests/cors-policy.test.ts)) |
| Listen address | `✅` | The server bound `0.0.0.0` unconditionally. It now defaults to `127.0.0.1` (`AI_SYSTEM_HOST` overrides); the image sets `0.0.0.0` and compose publishes on host loopback. [`server-shutdown.test.ts`](tests/server-shutdown.test.ts) proves a LAN address is refused |
| Rate limiting | `✅` | Per-address request budget (`AI_SYSTEM_RATE_LIMIT_PER_MINUTE`, default 600 from `server.ts`) and a lockout after 20 failed authentications in 5 minutes from a non-loopback address — refused even with a valid token, so a guesser cannot tell when it hit. `AI_SYSTEM_TRUST_PROXY` attributes requests behind a reverse proxy ([`rate-limit.ts`](ai-system/security/rate-limit.ts), [`rate-limit.test.ts`](tests/rate-limit.test.ts)) |
| Retention deleted live jobs | `✅` | Count-based retention kept the 100 newest records of any status, on every enqueue, so a backlog of queued work deleted itself. Only finished jobs are pruned now, by age or by count ([`queue-integrity.test.ts`](tests/queue-integrity.test.ts)) |
| Cancelled jobs flipped to completed | `✅` | `cancel()` took no lock, ignored `assigned` jobs and left the lease, and `completeJob` accepted results for a cancelled job. Cancel is now locked and covers every unfinished status; complete/fail refuse a cancelled job; the in-process run's final write and the waiting-for-approval write no longer overwrite a cancel |
| Cancel during approval hung the queue | `✅` | In server mode the approval wait ignored the abort signal, so cancelling a job waiting for approval left its run parked forever — holding its workspace and, at concurrency 1, the whole queue. [`approval-wait.ts`](ai-system/approvals/approval-wait.ts) ends the wait on cancel |
| Restart discarded worker results | `✅` | Startup marked every `running` job failed, including ones leased to external workers that outlive the server; their later `complete` returned `ok: true` and saved nothing. Only lease-less (in-process) runs are failed now, and completing an already-failed job is reported instead of swallowed |
| Unhandled rejections in the queue | `✅` | Startup cleanup, the drain loop, approval bookkeeping and maintenance had promises with nothing attached, so a brief store outage crashed the server. They are caught and logged; a failed drain retries after 1s |
| Unbounded command output | `✅` | Child output was buffered in full until V8's string limit threw and took the process down. Each stream keeps at most 10M characters, the tail ([`command-output-limit.test.ts`](tests/command-output-limit.test.ts)) |
| `POST /run` | `✅` | Ran synchronously outside the queue with no role check, ran while the queue was paused for worker mode, and parked forever on a task needing approval it could never get. It now takes the operator gate of `POST /jobs`, holds its workspace through the queue, and answers 409 when the queue is paused, the workspace is busy, or the task needs approval ([`sync-run-route.test.ts`](tests/sync-run-route.test.ts)) |
| Secrets in API responses | `✅` | `GET /config` masks every secret-named field (webhook secrets were sent in clear), and a save that echoes the mask back keeps the real value. Check output is redacted before it reaches `verification.json` or the server; redaction now also scrubs this process's secret env values and labelled `*_TOKEN=` / JSON fields, which vendor patterns missed ([`config-secrets.test.ts`](tests/config-secrets.test.ts), [`worker-verification-artifacts.test.ts`](tests/worker-verification-artifacts.test.ts)) |
| Worker identity | `✅` | Requests made with the shared worker token must carry that worker's session token; a lease is only usable by the worker holding it; a reported `artifactPath` outside the worker's workspace is dropped ([`worker-session.test.ts`](tests/worker-session.test.ts)) |
| Cancel propagation to workers | `✅` | A worker whose heartbeat is refused (409) aborts its provider run and verification, and does not report the discarded result |

## Orchestration Readiness

The stated goal is a PM agent that decomposes work and directs a fleet of other
agents. Measured against that goal rather than against uptime:

| Capability | State |
|---|---|
| Durable work items with a dependency DAG | `✅` `WorkItem` carries `dependsOn`, `ExecutionGraph`, `risk`, `assessment.modelTier` |
| Per-agent filesystem isolation | `✅` every worker job runs in its own `git worktree add --detach` |
| Capability routing | `✅` `workerSelector` matches on `os` and `labels`; claims are lease-backed |
| Intra-item fan-out | `✅` `runWorkItem` expands ready graph nodes into one job each and attaches run ids back |
| Cross-item batch dispatch | `✅` `dispatchReadyWorkItems` — see below |
| Parallel execution across a repo | `✅` proven with three worker processes on one repository — see below |
| N-of-M fan-out (e.g. five independent reviewers, majority vote) | `✅` [`review-panel.ts`](ai-system/core/review-panel.ts) — opt-in via `review_panel` config |
| Result aggregation across agents | `🟡` the review panel reconciles findings by quorum; nothing yet merges competing *code* outputs |
| A PM agent that decomposes a goal into owned subtasks | `⛔` `planner` emits `{readFiles, writeTargets, notes}` for one code change; it does not assign work |

### The conductor gap, and what closed part of it

`scheduleWorkItems` has always been able to compute a batch plan — tiering,
branch/worktree conflict detection, a parallel cap. Nothing dispatched it. The
CLI's `work schedule` printed `Ready: N, Blocked: M` and discarded the plan, and
`enqueueBatch` — the one method that would have queued it — had **zero callers**
anywhere in the codebase or its tests.

That is now wired, through [`dispatchReadyWorkItems`](ai-system/work/work-item-service.ts):

- `POST /work-items/dispatch` queues the whole ready backlog in one call
- `ai work dispatch [--max-parallel N] [--write]` drives it from the CLI
- Covered by [`work-item-dispatch.test.ts`](tests/work-item-dispatch.test.ts) and [`work-dispatch-route.test.ts`](tests/work-dispatch-route.test.ts)

`enqueueBatch` was removed rather than wired. It bypassed graph-node expansion,
approval-policy resolution, run-id linkage, and audit — connecting it would have
added a second, weaker dispatch path beside the one `runWorkItem` already
provides. Dispatch now routes every item through that proven path.

### Parallel agents, measured

Three worker processes were run against one server and one repository, with a
stub provider that occupies three seconds per invocation:

- All three claimed distinct jobs and began work within ~12ms of each other.
- Each stayed pinned to its own `git worktree` for the whole run, and each wrote
  a different output into its own tree.
- The main checkout ended with no source changes.
- Every job completed, each attributed to a different worker id.

`AI_SYSTEM_QUEUE_CONCURRENCY` does **not** gate this. In worker mode the
in-process queue is paused outright ([`server-app.ts`](ai-system/server-app.ts)),
so that setting only ever limited the in-process path. Worker parallelism is
bounded by how many worker processes are running, nothing else.

[`worker-parallel-throughput.test.ts`](tests/worker-parallel-throughput.test.ts)
pins the contract: three workers take three distinct jobs from one repository
concurrently, a fourth finds nothing rather than stealing a live lease, and two
workers holding a job apiece finish in less than the serial sum.

### Fan-out, measured

`review_panel` turns the single reviewer seat into a panel. Each lens gets its
own prompt narrowed to one concern, all lenses run concurrently, and findings
are reconciled by quorum.

Driven end to end against a real provider process with three lenses at quorum 2:

```
[high] agree=2/correctness+security quorum=true
       Token compare is not constant time [panel: 2/3 agree — correctness, security]
[low ] agree=1/security             quorum=false
       Solo security worry [panel: advisory, only 1/3 raised this — security]
```

The design choice worth knowing: a finding below quorum is **downgraded, not
dropped**. One lens cannot stall the pipeline on its own, but its finding still
reaches the operator — discarding it would waste the diversity the panel exists
for. A lens that fails is dropped and logged rather than failing the review, and
the quorum shrinks to the lenses that answered so a partly failed panel does not
silently demote everything.

Covered by [`review-panel.test.ts`](tests/review-panel.test.ts) for the
aggregation rules and [`review-panel-loop.test.ts`](tests/review-panel-loop.test.ts)
for the behaviour inside the real generation loop.

### What is still missing for the PM model

1. **A PM agent** that decomposes a goal into owned subtasks. The substrate is
   now there — DAG work items, batch dispatch, proven parallel workers, and a
   fan-out primitive to reason about verdicts.
2. **Aggregation of competing code outputs.** The panel reconciles *findings*.
   Nothing yet takes N candidate implementations and picks or merges one, which
   is what a PM directing several implementers would need.

Note what the parallel run also showed: one job is not one provider call. The
worker walks a job through its task phases, so three agents on three jobs
produced eight rounds of provider execution. Fan-out has to compose with that,
not replace it.

## Open Gaps

| Area | State | Gap |
|---|---|---|
| Multi-node active-active | `🟡` | Job locks are proven mutually exclusive across two connection pools, but no test runs two control-plane processes against one database. Single-node Postgres is proven; active-active is not. |
| Command policy | `🟡` | [`command-policy.ts`](ai-system/security/command-policy.ts) is a denylist. `find / -delete` and equivalents pass. A denylist gives more confidence than it earns; verification commands should move to an allowlist. |
| Worker record ordering | `🟡` | `WorkerStore.save()` is last-writer-wins with no read-modify-write lock, so a heartbeat can overwrite a concurrent status change. Unique temp names fixed the crash, not the lost update. |

## Fastest Path Forward

### Before claiming active-active HA

1. Run two control-plane processes against one Postgres database and exercise
   the claim/lease contract between them. Cross-pool lock exclusion is proven;
   two live control planes are not.

### Worth doing regardless

2. Move verification commands from the denylist to an allowlist.
3. Give `WorkerStore.save()` a read-modify-write lock so a heartbeat cannot
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
- [x] A scheduler-planned batch can actually be dispatched.
- [ ] Two control planes share one database without stepping on each other.
- [x] Token comparison is constant-time.
- [x] CORS is restricted to known origins.
- [x] The server listens on loopback unless told otherwise.
- [x] A token cannot act above its role, whatever headers it sends.
- [x] Job file reads cannot leave the artifact snapshot.
- [x] The clean-env sandbox actually withholds the server's environment.
- [x] Request rate is limited, and token guessing is locked out per address.
- [x] Retention never deletes a job that has not finished.
- [x] A cancelled job stays cancelled, whoever reports a result afterwards.
- [x] A server restart does not discard results from workers that outlived it.
- [x] A store outage is retried by the queue rather than crashing the server.
- [x] `POST /run` is gated, serialised per workspace, and cannot hang on approval.
- [x] No API response carries a configured secret or one a check printed.
- [x] A worker can only act as itself and only on its own leases.
- [x] Cancelling a worker job stops the provider run.
- [x] Several agents demonstrably run in parallel on one repository.
- [x] A task can fan out to N independent agents and have their verdicts merged.
- [ ] A PM agent decomposes a goal into subtasks that other agents execute.

## Bottom Line

**As a deployment**, ship it for an internal environment on a trusted network,
in a container, on either SQLite or Postgres. That envelope is covered end to
end: the image builds from the lockfile and runs unprivileged, the server drains
on `docker stop`, requests are bounded, auth is enforced at startup, the
Postgres backend is exercised by SQL that actually runs, and the suite's green
is reproducible.

The known gaps for network exposure are closed. Before exposing it, still put
TLS in front, set `AI_SYSTEM_TRUST_PROXY` behind that proxy, and remember that
verification commands run under a denylist, not an allowlist. Do not describe it as
active-active HA until two control planes have been run against one database.

**As a multi-agent orchestrator**, it is further along than it was but still
short of the goal. The substrate is unusually good — DAG work items, per-job
worktree isolation, lease-backed capability routing.
Batch dispatch reaches it, three agents have been shown working in parallel on
one repository each in its own worktree, and a review task can now fan out to N
independent lenses whose findings are reconciled by quorum. What is still absent
is the PM itself: nothing decomposes a goal into owned subtasks, and nothing
merges competing *code* outputs the way the panel merges findings. Judge the
project on that axis before promising the orchestration story; the deployment
checklist above will not catch it.
