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
