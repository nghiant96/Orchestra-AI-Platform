# Lessons Learned

## 2026-04-23: Do NOT batch-modify files outside scope

**Mistake**: Used `grep | sed` to batch-replace `from "node:` → `from "` across ~30 files,
touching many files that were working fine and not part of the current task.

**Rule**: Never use blind regex replacements across an entire codebase. Only touch files
that are explicitly part of the current task. If a systemic issue exists (like missing `@types/node`),
fix the root cause (install the package) instead of patching every file.

## 2026-04-23: ProviderSummary is serialized data — do NOT change its shape

**Mistake**: Changed `ProviderSummary` fields from `string` to `JsonProvider` (object with methods).
`ProviderSummary` is persisted to JSON on disk and read back. Changing it to objects would break
all serialization/deserialization and every CLI command that reads run state.

**Rule**: Before changing a type's shape, check if it's used in serialization (JSON.stringify,
file persistence, CLI output). Serializable interfaces must stay as plain data (strings, numbers,
arrays of primitives) — never contain class instances or methods.

## 2026-04-23: Match project import conventions

**Mistake**: Created new files with `import path from "path"` while the project consistently
uses `import path from "node:path"`.

**Rule**: Before writing new files, check the import convention of existing files in the project
and follow it exactly.

## 2026-04-29: Use the required completion tool in Antigravity

**Mistake**: Reported task completion in a plain assistant response even though the harness
required `attempt_completion`, causing an automated retry request.

**Rule**: When work is complete in this environment, finish with `attempt_completion` and include
the final task checklist there instead of replying conversationally.

## 2026-04-30: Server background resources must not outlive tests

**Mistake**: Added a maintenance `setInterval` inside `createAiSystemServer()` without clearing it
when tests called `server.close()`. The Node test runner finished assertions but stayed alive because
the interval kept the event loop open.

**Rule**: Any timer, interval, watcher, socket, or background worker created by server setup must be
disposed in the server close lifecycle. Use `unref()` for long-lived maintenance timers when appropriate,
and inspect active handles/processes before weakening tests that appear to hang after passing assertions.

## 2026-05-02: Polling tests must tolerate eventual consistency and cleanup races

**Mistake**: A queue test asserted that a job lookup must return `200` immediately and cleaned up temporary
directories with a single `fs.rm()` call. In this server, queued jobs can lag briefly before lookup succeeds
and `rmdir` can race with background file handles.

**Rule**: When testing queue or background workflows, poll for ready state instead of asserting immediate
availability. Use retrying cleanup helpers for temp directories and server artifacts so ENOTEMPTY races do
not hide otherwise passing behavior.

## 2026-05-02: Continue implementation when the user already approved execution

**Mistake**: Paused to ask for confirmation during a concrete implementation/refactor request after the user
had already said to proceed autonomously.

**Rule**: For concrete implementation tasks with clear acceptance criteria, continue through code changes and
verification without asking for another go-ahead. Only stop for user input when local context cannot resolve a
material product or safety decision.

## 2026-05-03: Do not let partial generation fall through to tool checks

**Mistake**: The run loop treated a partially generated candidate as if it were ready for lint/typecheck,
which turned a missing-write-target problem into a misleading tool failure.

**Rule**: Before running any repository tool checks, verify that every planned write target has been produced
or explicitly accounted for. If targets are missing, mark the iteration incomplete and re-enter the fix loop
instead of validating an unfinished candidate.

## 2026-05-03: Separate server readiness from HTTP readiness in tests

**Mistake**: A shared `listen()` helper assumed every test server exposed `/health`, which broke raw HTTP
servers and still left teardown races in queue-backed tests.

**Rule**: Use socket/listen readiness as the default helper and reserve HTTP probing for servers that expose
that endpoint. For queue-backed or filesystem-backed tests, close the server first and then retry cleanup
until the artifact directory is actually gone.

## 2026-05-03: Split orchestration flows by lifecycle, not by helper noise

**Mistake**: `orchestrator.ts` kept both `run` and `resume` plus retry helpers in one file, which made the
module shallow and hard to navigate even after smaller helpers were extracted.

**Rule**: When a class owns two distinct lifecycle flows, move each flow into its own module and keep the
class as a thin delegation seam. The delegate modules must be import-clean; otherwise the split just hides
the same complexity behind dead imports.

## 2026-05-03: Alias imported helpers when re-exporting the same public name

**Mistake**: Re-exported `getRoutingProfile` from the same module name without aliasing the imported helper,
which would have turned the public wrapper into a recursive self-call.

**Rule**: When a file exports a wrapper with the same name as an imported helper, always alias the import
first and call the alias from the wrapper. This avoids accidental recursion after module splits.

## 2026-05-03: Separate server-mode auth from local embedded permissions

**Mistake**: Treated server auth and embedded/local server permissions as one model, which would have broken
existing unauthenticated test flows while trying to harden server mode.

**Rule**: Gate server-mode requests with the configured token first, then resolve actor permissions differently
for local embedded mode versus authenticated server mode. Keep local test ergonomics permissive, but never
weaken the strict server-mode path.

## 2026-05-03: Dashboard API calls must share one auth-aware client

**Mistake**: Individual dashboard components fetched server routes directly and assumed `/health` always
returned a full payload. When server auth started rejecting unauthenticated requests, the UI crashed on
missing `health.queue`.

**Rule**: Route all dashboard API calls through a shared helper that adds auth headers when available and
normalize failed responses into `null`/empty states before rendering. UI state should tolerate 401s and
degraded server mode without throwing.
