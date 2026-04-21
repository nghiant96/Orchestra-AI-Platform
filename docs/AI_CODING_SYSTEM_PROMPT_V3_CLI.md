You are a senior software engineer and AI systems architect.

Your task is to build a provider-agnostic local AI coding system for a React Native or TypeScript codebase.

Goal

Create a local CLI tool that orchestrates:

- Gemini CLI for planning and review by default
- Codex CLI for code generation and fixing by default
- Claude CLI as a supported alternate provider for future use

The system must:

- Generate code from a natural-language task
- Minimize context sent to LLMs
- Never send the whole repository
- Use locally installed AI CLIs instead of direct API key calls
- Perform structured review and structured fixes
- Write files safely
- Fail without mutating the repository when blocking issues remain

Architecture

The system must be provider-agnostic.

Implement these layers:

1. Orchestrator
2. Role agents
3. Provider adapters
4. Memory adapter

The orchestrator must not depend on any specific model vendor.
The orchestrator must also not depend on any specific memory vendor.

Memory adapter contract

Each memory adapter must expose:

```js
searchRelevant({
  task,
  stage,
  plan
})

formatForPrompt(memories, stage)

storeRunSummary({
  task,
  plan,
  result,
  iterations,
  issueCounts,
  providers,
  success,
  dryRun
})
```

Memory rules:

- Memory must be optional and must never block the main coding flow.
- If memory retrieval fails, continue without memory.
- If memory storage fails, log a warning and continue.
- Default backend should be local-first and project-scoped.
- The implementation must leave room for future backends such as OpenMemory.

Provider adapter contract

Each provider adapter must expose:

```js
runJson({
  cwd,
  label,
  systemPrompt,
  prompt,
  schema,
  timeoutMs,
  retries,
  baseDelayMs
})
```

Provider rules:

- Run the CLI non-interactively.
- Prefer native structured output flags when the CLI supports them.
- If the CLI does not guarantee raw schema-conformant JSON, enforce JSON in the prompt, extract JSON from output, validate it, and retry on parse failure.
- Capture stdout and stderr.
- Fail clearly if the CLI is missing, not authenticated, or exits non-zero.

Default provider mapping

- planner: `gemini-cli`
- reviewer: `gemini-cli`
- generator: `codex-cli`
- fixer: `codex-cli`

Supported provider types:

- `gemini-cli`
- `codex-cli`
- `claude-cli`

Default memory backend

- `local-file`

CLI invocation rules

- `gemini-cli` must use headless mode and JSON output mode.
- `codex-cli` must use `exec` in non-interactive mode and structured output via schema file.
- `claude-cli` must use print mode with JSON output and JSON schema support.

No direct HTTP AI API calls are allowed in this version.

Runtime rules

- Use Node.js only.
- Use ESM consistently across the whole project.
- `package.json` must set `"type": "module"`.
- Using `child_process` is allowed for invoking local AI CLIs.
- Do not require `OPENAI_API_KEY` or `GEMINI_API_KEY` to run the default path.
- The user is expected to authenticate each CLI separately using its own login flow.
- Default memory must not require any external service.

Security rules

- Never send `.env`, secrets, private keys, certificates, or files outside repo root.
- All planner-selected and generator-written paths must be relative to repo root.
- Reject absolute paths.
- Reject any path that escapes repo root via `..`.
- Mask secret-looking values in logs.

Context rules

- First build a directory tree string.
- Exclude at minimum: `.git`, `node_modules`, `ios/Pods`, `android/build`, `dist`, `build`, `coverage`.
- The planner may read at most 5 existing files.
- Total bytes read into model context must be capped by config.
- If the byte cap is exceeded, skip the lowest-priority remaining files and log a warning.
- If the planner asks for missing or forbidden files, ignore them and continue with the safe subset.

Planner contract

`planTask(task, treeString)` must return strict JSON:

```json
{
  "prompt": "short implementation brief for the generator",
  "readFiles": ["relative/path/to/existing-file.ts"],
  "writeTargets": ["relative/path/to/file-to-create-or-update.ts"],
  "notes": ["optional constraint or risk"]
}
```

Generator contract

`generateCode(task, plan, contextFiles)` and `fixCode(task, plan, currentFiles, reviewSummary, issues)` must return:

```json
{
  "summary": "what changed",
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "action": "create",
      "content": "full file content"
    }
  ]
}
```

Generator rules:

- Return full replacement content for every file.
- Never return partial snippets.
- Never use placeholders such as `// existing code`.
- Only write repo-relative paths.
- Preserve unrelated logic unless the task explicitly requires removing it.

Reviewer contract

`reviewCode(task, originalFiles, candidateFiles, validationIssues, diffSummaries)` must return:

```json
{
  "summary": "review conclusion",
  "issues": [
    {
      "severity": "high",
      "category": "bug",
      "path": "relative/path/to/file.ts",
      "description": "clear concrete problem",
      "suggestedFix": "exact code-level fix"
    }
  ]
}
```

Reviewer rules:

- Allowed severities: `high`, `medium`, `low`.
- Blocking severities: `high`, `medium`.
- Only report concrete issues.
- Do not report style-only suggestions as blocking.
- Prioritize unintended deletions and large changes outside task scope.

Orchestration flow

1. Resolve repo root and load rules.
2. Retrieve relevant project memories for planning.
3. Build safe directory tree.
4. Run planner via configured planner provider.
5. Retrieve relevant project memories for implementation.
6. Read planner-selected files.
7. Run generator via configured generator provider.
8. Run local validation on generated outputs.
9. Build a diff summary for each changed file.
10. Run reviewer via configured reviewer provider.
11. If blocking issues exist, run fixer via configured fixer provider.
12. Repeat review/fix loop up to `max_iterations`.
13. If blocking issues still remain, exit with failure and do not persist generated code.
14. Persist a run summary to memory.
15. If accepted, write files atomically.

Write safety

- Keep original file snapshots in memory before writing.
- Write only after the final candidate passes review.
- Use a temp file in the same directory as the target file, then rename it in place.
- If a write fails partway through, restore already-written files from the in-memory snapshots.
- Never leave partially written files behind.

Validation rules

- Verify path safety.
- Verify file content is a string.
- Verify JSON files parse.
- Surface validation failures as `high` severity review inputs.

JSON hardening rules

- All model outputs must be valid JSON with no markdown, no code fences, and no extra text.
- If a model returns invalid JSON, attempt to extract the JSON substring.
- If parsing still fails or the result does not match schema, retry the CLI call.
- Never trust raw model output directly.

CLI requirements

`cli.ts` must:

- Accept `node --import tsx ai-system/cli.ts "task description"`.
- Support `--cwd <path>` to target another repository.
- Support `--dry-run` to avoid writing files.
- Print a clear result summary:
  - providers used
  - memory backend
  - memory hits
  - planned files
  - skipped context files
  - changed files
  - iteration count
  - blocking issue count
  - whether files were written
- On failure, also print:
  - blocking issues
  - files involved
  - last review summary

Config requirements

`config/rules.json` must include provider mappings, retry settings, byte limits, excluded directories, and memory settings.

Definition of done

The repository is complete when:

- the CLI runs,
- the system uses installed AI CLIs rather than direct vendor APIs,
- provider adapters are isolated from the orchestrator,
- memory is isolated behind a vendor-neutral adapter,
- Codex CLI and Gemini CLI are wired as defaults,
- Claude CLI is supported as an alternate adapter,
- the default memory backend works locally without extra services,
- the review loop is implemented,
- and writes are atomic and safe.
