You are a senior software engineer and AI systems architect.

Your task is to build a production-minded local AI coding system for a React Native or TypeScript codebase.

Goal

Create a local CLI tool that orchestrates:

- Gemini as planner and reviewer
- OpenAI as code generator and fixer

The system must:

- Generate code from a natural-language task
- Minimize context sent to LLMs
- Never send the whole repository
- Perform structured review and structured fixes
- Write files safely
- Fail without mutating the repository when blocking issues remain

Deliverables

Implement exactly this structure:

ai-system/
├── cli.js
├── agents/
│   ├── gemini.js
│   └── codex.js
├── core/
│   ├── orchestrator.js
│   ├── context.js
│   └── reviewer.js
├── utils/
│   ├── api.js
│   ├── logger.js
│   └── string.js
├── config/
│   └── rules.json

Also provide:

- package.json with script `"ai": "node ai-system/cli.js"`
- README.md with setup and usage

Runtime rules

- Use Node.js only.
- Use ESM consistently across the whole project.
- `package.json` must set `"type": "module"`.
- Do not use `child_process` for AI API calls.
- Use `fetch` or official HTTP APIs for all AI communication.
- Load environment variables from `.env` when present.
- If required API keys are missing, exit with a clear error before any file write.

Security rules

- Never send `.env`, secrets, private keys, certificates, or files outside repo root.
- All planner-selected and generator-written paths must be relative to repo root.
- Reject absolute paths.
- Reject any path that escapes repo root via `..`.
- Mask secret-looking values in logs.

Context rules

- First build a directory tree string.
- Exclude at minimum: `.git`, `node_modules`, `ios/Pods`, `android/build`, `dist`, `build`, `coverage`.
- Gemini planner may read at most 5 existing files.
- Total bytes read into model context must be capped by config.
- If the byte cap is exceeded, skip the lowest-priority remaining files and log a warning.
- If planner asks for missing or forbidden files, ignore them and continue with the safe subset.

Planner contract

`agents/gemini.js` must expose `planTask(task, treeString, rules)`.

The planner output must be strict JSON with this schema:

```json
{
  "prompt": "short implementation brief for the generator",
  "readFiles": ["relative/path/to/existing-file.ts"],
  "writeTargets": ["relative/path/to/file-to-create-or-update.ts"],
  "notes": ["optional constraint or risk"]
}
```

Planner rules:

- `prompt` must be concise and implementation-oriented.
- `readFiles` max length: 5.
- `writeTargets` max length: 8.
- Every path must be repo-relative.
- `readFiles` must refer to existing files.
- `writeTargets` may include new files.
- Focus on the smallest safe context needed to complete the task.

Generator contract

`agents/codex.js` must expose:

- `generateCode(task, plan, contextFiles, rules)`
- `fixCode(task, plan, currentFiles, reviewSummary, issues, rules)`

Both functions must return strict JSON with this schema:

```json
{
  "summary": "what changed",
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "action": "create",
      "content": "full file content"
    },
    {
      "path": "relative/path/to/file.tsx",
      "action": "update",
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
- Limit writes to planned targets unless a clearly necessary supporting file is required.
- If a supporting file is added, it must still remain inside repo root.
- When updating existing files, preserve unrelated logic unless the task explicitly requires removing it.

Reviewer contract

`agents/gemini.js` must also expose `reviewCode(task, plan, isStrict, originalFiles, candidateFiles, validationIssues, diffSummaries, cwd, memoryContext?)`.

The reviewer output must be strict JSON with this schema:

```json
{
  "summary": "review conclusion",
  "issues": [
    {
      "severity": "high",
      "category": "bug",
      "path": "relative/path/to/file.ts",
      "description": "clear concrete problem",
      "suggestedFix": "short actionable fix"
    }
  ]
}
```

Reviewer rules:

- Allowed severities: `high`, `medium`, `low`.
- Blocking severities: `high`, `medium`.
- Only report concrete issues.
- Do not report style-only suggestions as blocking.
- Review the actual before/after file contents, not only the prompt.
- Every issue must include an exact file path and an exact code-level suggested fix.
- Prioritize unintended deletions and large changes outside task scope.

Orchestration flow

`core/orchestrator.js` must implement this exact lifecycle:

1. Resolve repo root and load rules.
2. Build safe directory tree.
3. Call Gemini planner.
4. Read planner-selected files.
5. Call OpenAI generator.
6. Run local validation on generated outputs.
7. Build a diff summary for each changed file.
8. Call Gemini reviewer on original vs generated files plus local validation findings and diff summaries.
9. If blocking issues exist, call OpenAI fixer.
10. Repeat review/fix loop up to `max_iterations`.
11. If blocking issues still remain, exit with failure and do not persist generated code.
12. If accepted, write files atomically.

Write safety

- Keep original file snapshots in memory before writing.
- Write only after the final candidate passes review.
- Use a temp file in the same directory as the target file, then rename it in place.
- If a write fails partway through, restore already-written files from the in-memory snapshots.
- Never leave partially written files behind.

Validation rules

Implement lightweight local validation before reviewer acceptance:

- Verify path safety.
- Verify file content is a string.
- Verify JSON files parse.
- Surface validation failures as `high` severity review inputs.

`validationIssues` must be an array of objects with this shape:

```json
[
  {
    "path": "relative/path/to/file.json",
    "severity": "high",
    "category": "validation",
    "description": "clear validation failure",
    "suggestedFix": ""
  }
]
```

If project-specific lint or typecheck execution is not implemented, do not claim that the system guarantees semantic correctness.

API rules

- Gemini calls must use the Gemini API over HTTP.
- OpenAI calls must use the OpenAI Responses API over HTTP.
- Use structured JSON output when supported.
- All model outputs must be valid JSON with no markdown, no code fences, and no extra text.
- Still sanitize model output before parsing because models may wrap or corrupt JSON.
- If a model returns invalid JSON, attempt to extract the JSON substring and retry if parsing still fails.
- Implement retry with exponential backoff for transient failures including 429 and 5xx.
- Implement request timeout.

CLI requirements

`cli.js` must:

- Accept `node ai-system/cli.js "task description"`.
- Support `--cwd <path>` to target another repository.
- Support `--dry-run` to avoid writing files.
- Print a clear result summary:
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

`config/rules.json` must include at least:

```json
{
  "max_iterations": 3,
  "max_files": 5,
  "token_limit_hint": 12000,
  "request_timeout_ms": 60000,
  "request_retries": 3,
  "retry_base_delay_ms": 500
}
```

It may also include:

- excluded directories
- byte limits
- default model names
- retry and timeout settings

Non-goals

- Do not build a daemon.
- Do not build a web UI.
- Do not add a database.
- Do not overengineer abstractions.

Definition of done

The repository is complete when:

- the CLI runs,
- the folder structure matches this spec,
- the AI calls are wired through HTTP,
- the review loop is implemented,
- writes are atomic and safe,
- and the README explains how to use the system.
