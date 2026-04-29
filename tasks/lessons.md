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
