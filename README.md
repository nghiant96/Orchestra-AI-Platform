# Orchestra-AI-Platform

A local CLI-first coding system that uses installed AI CLIs instead of direct API key integrations.

## What it does

- Builds a safe directory tree for a target repository
- Lets a planner provider choose a small set of relevant files
- Sends only those files to a generator provider for full-file generation
- Runs configurable repo checks (`lint`, `typecheck`, optional `build` / `test`) before review
- Runs a review and fix loop up to a configured maximum
- Retrieves relevant project memory before planning and implementation
- Expands context with dependency and vector-search signals when enabled
- Supports dry-run, checkpoints, resume/retry, artifact apply, and review-only workflows
- Can run as a local HTTP service with synchronous and queued job APIs
- Writes accepted files atomically

## Requirements

- Node.js 20+ recommended, tested on Node.js 24
- `pnpm` for this repository's scripts
- Installed and authenticated AI CLIs for the providers you want to use
- Defaults assume:
  - `gemini` is installed for planner/reviewer
  - `codex` is installed for generator/fixer
- Optional: Docker for containerized tool checks or server deployment
- Optional: `tree-sitter`, `tree-sitter-python`, `tree-sitter-go`, and `tree-sitter-rust` for more precise Python/Go/Rust symbol parsing; without them, indexing falls back safely

Optional alternate provider:

- `claude`

## Setup

Log into the CLIs you plan to use:

```bash
gemini
codex login
# optional
claude
```

## Quick Start

There are two recommended local setup modes:

### Option 1: Local CLI mode

Use installed CLIs directly. No `.env` is required.

```bash
ai "Refactor the auth flow"
# or
pnpm run ai:local -- "Refactor the auth flow"
```

### Option 2: 9router mode

Copy the env file once, set your API key, then run the tool normally.

```bash
cp .env.example .env
ai "Refactor the auth flow"
# or
pnpm run ai:9router -- "Refactor the auth flow"
```

The minimal `.env` is:

```bash
AI_SYSTEM_PROVIDER=9router
AI_SYSTEM_API_KEY=copy-from-9router-dashboard
AI_SYSTEM_MODEL=model-from-your-9router-dashboard
```

## CLI-First Local Usage

This is the default workflow. Use it when you are coding locally and want a terminal experience similar to Gemini CLI.

Start an interactive session:

```bash
ai
# or
pnpm run ai:chat
```

Run a one-shot task in the current directory:

```bash
pnpm ai "Add retry handling to the API client"
```

Run against another repository:

```bash
pnpm ai --cwd /absolute/path/to/repo "Refactor the auth hook to handle refresh tokens"
```

Preview without writing files:

```bash
pnpm ai --dry-run "Add a reusable loading state component"
```

Use project-level config:

```bash
cp .ai-system.json.example .ai-system.json
ai --chat
```

Inspect or change the active project config without editing JSON by hand:

```bash
ai implement "Refactor the auth flow"
ai review
ai review "Propose and review auth changes"
ai fix "Fix the auth flow regression"
ai setup
ai setup --check
ai config show
ai config use codex-all
ai doctor
ai explain-routing "Refactor the auth flow"
ai runs latest
ai runs list
ai runs show last
ai runs show last --json
ai review --json --save ./tmp/review.json
ai review --staged --json --save ./tmp/staged-review.json
ai review --files src/auth.ts,src/session.ts --json --save ./tmp/file-scope-review.json
ai review --staged --files src/auth.ts --json --save ./tmp/staged-file-scope-review.json
ai review --base origin/main --files src/auth.ts --json --save ./tmp/base-file-scope-review.json
ai runs show last --json --save ./tmp/run.json
ai apply --from-artifact last
ai fix-checks
ai retry last --stage reviewing
```

Use a hybrid setup where planning/review stays on Gemini CLI but generation/fixing uses 9router:

```bash
cp .ai-system.hybrid.json.example .ai-system.json
ai --chat
```

Use 9router with env:

```bash
AI_SYSTEM_PROVIDER=9router \
AI_SYSTEM_API_KEY=copy-from-9router-dashboard \
ai --dry-run "Refactor the auth flow"
```

Or use the built-in preset:

```bash
ai --9router --chat
ai --provider 9router --dry-run "Refactor the auth flow"
```

Use a repo-local `.env` instead of exporting variables every time:

```bash
cp .env.example .env
ai --chat
```

Recommended config workflow:

- Use `ai implement "task"` for the standard write-enabled implementation flow
- `ai implement` runs the normal implementation loop: plan -> implement -> checks -> auto-fix until the repo is green or the configured iteration budget is exhausted
- Use `ai review` to review the current working tree when the repo already has changes
- Use `ai review --staged` to review only the changes that are currently staged in git
- Use `ai review --base <git-ref>` to review the current repo state against a base ref like `main` or `origin/main`
- Use `ai review --failing-checks` to review the code regions implicated by the currently failing repo checks
- Use `ai review --files <path[,path2...]>` or repeat `--files` to review only a very specific file scope against `HEAD`
- You can combine `--files` with `--staged` or `--base <git-ref>` when you want a very precise git-backed review scope
- Use `ai review "task"` for a dry-run review flow with plan approval and a generation checkpoint when there are no current changes to inspect
- Use `ai fix "task"` for an interactive fix-focused flow that still writes files when approved
- Use `ai fix-checks` to run the configured repo checks, convert failing output into a structured repair task, and execute the normal fix loop against it
- Use `ai retry <target> --stage <stage>` when you need to force a rerun from a specific state-machine checkpoint such as `reviewing`, `fixing`, or `writing`
- Use `ai setup` to configure `planner`, `reviewer`, `generator`, `fixer`, routing behavior, and OpenMemory connection interactively
- `ai setup` also configures the project tool checks (`lint`, `typecheck`, `build`, `test`) and changed-file scoping preferences
- Use `ai setup --check` to verify CLI availability and OpenMemory connectivity without changing files
- Put day-to-day behavior in `.ai-system.json`
- Put secrets and host-specific values in `.env`
- Use `ai config use codex-all|hybrid|safe-review` to switch project presets
- Use `ai config show` to inspect the effective config
- Use `ai doctor` when behavior is surprising and you need to see env/routing overrides
- `ai doctor` now also shows the effective run duration/cost budgets
- Use `ai explain-routing "task"` to see why the current config would pick specific providers for that task
- Use `ai runs latest` to inspect the latest artifact-backed run summary quickly, including execution time, failure class, and step durations
- `ai runs latest/show` also surface run budget usage and budget-exceeded failures when those limits are configured
- Use `ai runs list` to browse recent artifact-backed runs
- Use `ai runs show <target>` to inspect a specific run directory or `run-state.json`
- `ai runs latest/show` will also surface persisted semantic vector matches when vector context expansion is active for that run
- Add `--json` to `ai runs ...`, `ai review`, or `ai apply --from-artifact` when you want machine-readable output
- Add `--save /path/to/file.json` together with `--json` when you want the CLI to write the payload directly to disk for automation/reporting
- Example reporting flow:
  - `ai review --staged --json --save ./tmp/staged-review.json`
  - `ai review --base origin/main --json --save ./tmp/base-review.json`
  - `ai review --files src/auth.ts --files src/session.ts --json --save ./tmp/file-review.json`
  - `ai review --staged --files src/auth.ts --json --save ./tmp/staged-file-review.json`
  - `ai review --base origin/main --files src/auth.ts --json --save ./tmp/base-file-review.json`
- Use `ai apply --from-artifact <target>` to apply a saved candidate from artifacts without rerunning generation
- Add `--force` to `ai apply --from-artifact` when you intentionally want to apply a candidate that still has blocking review issues
- Each `ai apply --from-artifact` invocation now persists an audit event under the run artifacts and surfaces the latest apply event in `ai runs latest/show`
- Use `ai fix --from-run <target>` to continue from a previous run, resuming directly when the run is retryable or building a focused follow-up repair task when it is not
- Interactive TTY runs now open a live `blessed` dashboard for status and recent activity; set `AI_SYSTEM_DISABLE_TUI=true` when you want plain console logging instead
- For HTTP server, dashboard, queue, approval, artifact, audit, and release smoke workflows, see `docs/OPERATIONS.md`

Tool execution workflow:

- The generation loop now runs structured repo checks before review
- Default checks:
  - `json-validation`
  - auto-detected `lint`
  - auto-detected `typecheck`
- Optional checks:
  - `build`
  - `test`
- Recommended safe profile checks for this repository:
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm test`
  - `pnpm run dashboard:build`
  - `pnpm audit --audit-level high --registry https://registry.npmjs.org`
  - `git diff --check`
- Scoped execution heuristics now prefer:
  - `lint:changed` / `lint:files` / `lint:staged` when present
  - `test:changed` / `test:related` / `test:affected` when present
  - package-local `lint` / `test` scripts when all changed files fall under one workspace package
  - package-local `typecheck` or `type-check` scripts when a single changed workspace package owns the change
  - package-local `tsconfig.json` / `tsconfig.build.json` fallback when no explicit package typecheck script exists
  - `pnpm --filter ... run <script>` when changed files span multiple workspace packages that share the same script name
- Tool execution sandboxing now supports:
  - `inherit` to run with the normal host environment
  - `clean-env` to run with a minimal allowlisted environment plus explicit passthrough keys
  - `docker` with explicit or auto-selected images for Node, Python, Go, and Rust projects
- Non-Node project adapters now support:
  - Python projects detected by `pyproject.toml`, `pytest.ini`, or `requirements.txt`, defaulting to `pytest`
  - Go projects detected by `go.mod`, defaulting to `go test ./...`
  - Rust projects detected by `Cargo.toml`, defaulting to `cargo test`
- Context intelligence now supports:
  - dependency-aware file expansion from planner-selected files
  - semantic vector search over embedded local chunks when `vector_search.enabled=true`
  - parser-backed symbol-aware chunking for TS/JS-family files, optional Tree-sitter parsing for Python/Go/Rust, and line-based fallback for other supported languages
  - ranked context selection so planner files, write targets, dependency neighbors, and semantic matches are ordered before byte-budget trimming
  - budget-aware context trimming so pinned files stay in and oversized low-value candidates are dropped before prompt assembly
  - operator visibility for top ranked context contributors in `ai runs latest/show`
- Adaptive routing now supports:
  - recent run outcome tracking from `.ai-system-artifacts`
  - category-aware routing history (`docs`, `risky`, `general`)
  - profile scoring and role overrides based on recent provider performance in the same category
- Use `ai doctor` to see effective providers, budgets, parser mode, prompt overrides, tool commands, sandbox image, execution scope, and working directory

Example project tool config in `.ai-system.json`:

```json
{
  "tools": {
    "enabled": true,
    "json_validation": true,
    "sandbox": {
      "mode": "docker",
      "image_profile": "auto",
      "auto_build": false,
      "include_env": ["CI"]
    },
    "commands": {
      "lint": {
        "enabled": true,
        "script": "lint:changed",
        "args": ["{changed_files}"]
      },
      "typecheck": {
        "enabled": true,
        "script": "typecheck"
      },
      "build": {
        "enabled": false
      },
      "test": {
        "enabled": true,
        "command": "pnpm",
        "args": ["vitest", "run", "{changed_files}"]
      }
    }
  }
}
```

When `tools.sandbox.mode` is `docker`, `tools.sandbox.image` wins over all profile settings. Without an explicit image, `image_profile: "auto"` maps detected adapters to `ai-coding-system:python`, `ai-coding-system:go`, or `ai-coding-system:rust`; otherwise the fallback remains `ai-coding-system:local`. If the image is missing and `auto_build` is false, the tool check is skipped with the exact `docker build` command to run. Set `auto_build: true` and optionally `dockerfile` to let the tool preflight build the image. Docker sandboxing remains opt-in; `inherit` stays the default.

Example safety-oriented tool sandbox config:

```json
{
  "tools": {
    "enabled": true,
    "sandbox": {
      "mode": "clean-env",
      "include_env": ["CI", "GITHUB_ACTIONS"],
      "extra_env": {
        "FORCE_COLOR": "1"
      }
    }
  }
}
```

Example embedded vector-search config:

```json
{
  "vector_search": {
    "enabled": true,
    "data_dir": ".ai-system-vector",
    "max_results": 4,
    "max_indexed_files": 200,
    "max_file_bytes": 65536,
    "chunk_size": 1200,
    "chunk_overlap": 200,
    "parsers": {
      "mode": "auto",
      "tree_sitter_languages": ["python", "go", "rust"]
    }
  }
}
```

- When enabled, the orchestrator indexes safe workspace files into local semantic chunks and merges the top matches into `plan.readFiles`
- The current implementation is local-first and embedded; it reuses the existing `@xenova/transformers` embedder and degrades gracefully to lexical ranking when embeddings are unavailable
- Tree-sitter is optional. If `tree-sitter` or a grammar package is unavailable or fails, indexing falls back to the TypeScript AST parser, line-based parsers, or fixed chunks depending on file type. Use `mode: "tree-sitter"` only when you want to require a Tree-sitter attempt before fallback.

Example custom prompt config:

```json
{
  "prompts": {
    "directory": ".ai-system-prompts",
    "templates": {
      "reviewer": ".ai-system-prompts/strict-reviewer.md"
    },
    "examples_directory": ".ai-system-prompts/examples"
  }
}
```

- Copy the built-in prompts from `ai-system/prompts/*.md` into your prompt directory and edit only the templates you need.
- Supported template variables are `{{examples}}`, planner-only `{{max_files}}`, and generator-only `{{rules_summary}}`.
- Missing custom templates fall back to built-ins; missing custom examples fall back to built-in examples or an empty examples block.
- Prompt paths must be repo-relative or absolute under the project/global config roots. Unsafe traversal is rejected. Use `ai doctor` to inspect effective config and tool behavior when troubleshooting.

Supported changed-file placeholders in tool args:

- `{changed_files}` expands to one argument per changed file
- `{changed_files_csv}` expands to a single comma-separated argument
- `append_changed_files: true` appends changed file paths to the configured args

Inside interactive mode:

```text
/help
/status
/dry-run
/dry-run off
/interactive
/interactive off
/provider 9router
/provider clear
/cwd ../another-project
/config .ai-system.json
/config clear
/exit
```

Useful local overrides:

```bash
AI_SYSTEM_REVIEWER_PROVIDER=claude-cli pnpm ai --dry-run "Review the generated hook changes"
AI_SYSTEM_MEMORY=off pnpm ai --dry-run "Refactor the auth flow"
AI_SYSTEM_MEMORY=openmemory \
AI_SYSTEM_OPENMEMORY_BASE_URL=http://127.0.0.1:8080 \
pnpm ai --dry-run "Refactor the auth flow"
AI_SYSTEM_GENERATOR_TIMEOUT_MS=480000 AI_SYSTEM_FIXER_TIMEOUT_MS=300000 pnpm ai "Tách project hiện tại thành dự án mới với tên Edura+"
AI_SYSTEM_GENERATOR_TIMEOUT_MS=0 AI_SYSTEM_FIXER_TIMEOUT_MS=0 pnpm ai "Tách project hiện tại thành dự án mới với tên Edura+"
AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS=60000 \
AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS=60000 \
pnpm ai "Tách project hiện tại thành dự án mới với tên Edura+"
```

Review the AI plan before it generates code:

```bash
ai --interactive "Refactor the auth flow"
```

Pause after key checkpoints:

```bash
ai --pause-after-plan "Refactor the auth flow"
ai --pause-after-generate "Refactor the auth flow"
ai --manual-review "Refactor the auth flow"
```

Manual review safety:

- Every generated candidate is saved under `.ai-system-artifacts/` before it is accepted.
- If review or validation fails, you can still open the latest candidate files and inspect `manifest.json` for issues and diff summaries.
- Each run now saves step checkpoints:
  - `01-plan/plan.json`
  - `02-context/context.json` and `02-context/files/`
  - `iteration-N/manifest.json` and `iteration-N/files/`
- `--manual-review` combines plan approval, pause after planner, and pause after each generated candidate.

## Docker and Server Usage

Use this mode only when you want a long-lived service, remote deployment, or containerized execution.

Build the image:

```bash
docker build -t ai-coding-system:local .
```

Run a one-shot container job against the current repository:

```bash
docker run --rm -it \
  -v "$PWD:/workspace" \
  -v "$HOME/.gemini:/root/.gemini" \
  -v "$HOME/.codex:/root/.codex" \
  -v "$HOME/.claude:/root/.claude" \
  ai-coding-system:local \
  --dry-run "Add a reusable loading state component"
```

Run as a long-lived HTTP service:

```bash
docker run --rm -it \
  -e AI_SYSTEM_SERVER_MODE=true \
  -e AI_SYSTEM_SERVER_TOKEN=change-me \
  -e AI_SYSTEM_WORKDIR=/workspace \
  -e PORT=3927 \
  -p 3927:3927 \
  -v "$PWD:/workspace" \
  -v "$HOME/.gemini:/root/.gemini" \
  -v "$HOME/.codex:/root/.codex" \
  -v "$HOME/.claude:/root/.claude" \
  ai-coding-system:local
```

Use Docker Compose for a one-shot local run:

```bash
docker compose run --rm ai-coding-system --dry-run "Refactor the auth flow"
```

Run Docker Compose in server mode:

```bash
AI_SYSTEM_SERVER_MODE=true AI_SYSTEM_SERVER_TOKEN=change-me docker compose up ai-coding-system
```

Shortcuts in this repo:

```bash
pnpm docker:up
pnpm docker:down
pnpm docker:logs
```

Or with `make`:

```bash
make ai-up
make ai-down
make ai-logs
```

If you want a custom token:

```bash
AI_SYSTEM_SERVER_TOKEN=my-secret make ai-up
```

Deploy on a server:

```bash
docker build -t registry.example.com/ai-coding-system:latest .
docker push registry.example.com/ai-coding-system:latest
```

Then run it on the server by mounting:

- the target repository to `/workspace`
- CLI auth directories to `/root/.gemini`, `/root/.codex`, and optionally `/root/.claude`

Example:

```bash
docker run --rm -it \
  -v /srv/my-repo:/workspace \
  -v /srv/ai-auth/.gemini:/root/.gemini \
  -v /srv/ai-auth/.codex:/root/.codex \
  -v /srv/ai-auth/.claude:/root/.claude \
  registry.example.com/ai-coding-system:latest \
  "Implement retry handling for the API client"
```

If your platform starts the container with no command, set:

- `AI_SYSTEM_SERVER_MODE=true`
- `PORT=3927` or the platform's assigned port
- `AI_SYSTEM_SERVER_TOKEN=<shared-secret>`
- `AI_SYSTEM_WORKDIR=/workspace`
- `AI_SYSTEM_ALLOWED_WORKDIRS=/workspace` or a comma-separated allowlist for multiple mounted repositories

Then call the service:

```bash
curl -X POST http://127.0.0.1:3927/run \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"task":"Implement retry handling for the API client","dryRun":true}'
```

Queue API:

```bash
curl -X POST http://127.0.0.1:3927/jobs \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"task":"Implement retry handling for the API client","cwd":"/workspace","dryRun":true}'

curl http://127.0.0.1:3927/jobs \
  -H "Authorization: Bearer change-me"

curl http://127.0.0.1:3927/jobs/<jobId> \
  -H "Authorization: Bearer change-me"

curl -X POST http://127.0.0.1:3927/jobs/<jobId>/cancel \
  -H "Authorization: Bearer change-me"
```

- Jobs are stored under `.ai-system-server/jobs` in `AI_SYSTEM_WORKDIR`.
- Set `AI_SYSTEM_QUEUE_CONCURRENCY` to run more than one job at a time in the same process.
- Set `AI_SYSTEM_ALLOWED_WORKDIRS` to a comma-separated allowlist when enqueueing jobs for multiple mounted projects.
- Queue states are `queued`, `running`, `completed`, `failed`, `cancel_requested`, and `cancelled`.

## Configuration Reference

Project config guidance:

- `ai-system/config/rules.json` is an internal default file. Do not treat it as the normal place to customize a project.
- `.ai-system.json` is the primary project-level config for provider choices, routing, memory backend, and other long-lived behavior.
- `.env` is the right place for secrets such as `AI_SYSTEM_OPENMEMORY_API_KEY` and host-specific URLs such as `AI_SYSTEM_OPENMEMORY_BASE_URL`.
- Project presets currently available through `ai config use`:
  - `codex-all`
  - `hybrid`
  - `safe-review`

Optional environment variables:

- `AI_SYSTEM_PROVIDER`
- `AI_SYSTEM_MEMORY`
- `AI_SYSTEM_MAX_ITERATIONS`
- `AI_SYSTEM_MAX_FILES`
- `AI_SYSTEM_TOKEN_LIMIT_HINT`
- `AI_SYSTEM_PLANNER_PROVIDER`
- `AI_SYSTEM_REVIEWER_PROVIDER`
- `AI_SYSTEM_GENERATOR_PROVIDER`
- `AI_SYSTEM_FIXER_PROVIDER`
- `AI_SYSTEM_PLANNER_TIMEOUT_MS`
- `AI_SYSTEM_REVIEWER_TIMEOUT_MS`
- `AI_SYSTEM_GENERATOR_TIMEOUT_MS`
- `AI_SYSTEM_FIXER_TIMEOUT_MS`
- `AI_SYSTEM_PLANNER_MONITOR_INTERVAL_MS`
- `AI_SYSTEM_REVIEWER_MONITOR_INTERVAL_MS`
- `AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS`
- `AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS`
- `AI_SYSTEM_PLANNER_RETRIES`
- `AI_SYSTEM_REVIEWER_RETRIES`
- `AI_SYSTEM_GENERATOR_RETRIES`
- `AI_SYSTEM_FIXER_RETRIES`
- `AI_SYSTEM_MEMORY_ENABLED`
- `AI_SYSTEM_MEMORY_BACKEND`
- `AI_SYSTEM_MEMORY_TRANSPORT`
- `AI_SYSTEM_OPENMEMORY_BASE_URL`
- `AI_SYSTEM_OPENMEMORY_API_KEY`
- `AI_SYSTEM_BASE_URL`
- `AI_SYSTEM_API_KEY`
- `AI_SYSTEM_MODEL`
- `AI_SYSTEM_OPENAI_BASE_URL`
- `AI_SYSTEM_OPENAI_API_KEY`
- `AI_SYSTEM_OPENAI_MODEL`
- `AI_SYSTEM_9ROUTER_BASE_URL`
- `AI_SYSTEM_9ROUTER_API_KEY`
- `AI_SYSTEM_9ROUTER_MODEL`
- `AI_SYSTEM_DISABLE_TUI`
- `AI_SYSTEM_GLOBAL_CONFIG`
- `AI_SYSTEM_GLOBAL_CONFIG_PATH`
- `AI_SYSTEM_SERVER_MODE`
- `AI_SYSTEM_SERVER_TOKEN`
- `AI_SYSTEM_PORT`
- `AI_SYSTEM_WORKDIR`
- `AI_SYSTEM_ALLOWED_WORKDIRS`
- `AI_SYSTEM_QUEUE_CONCURRENCY`
- `.env` is auto-loaded from the target repository root when present

## Container Notes

- The image bundles `gemini`, `codex`, and `claude` CLIs via their npm packages.
- Authentication is expected to come from mounted CLI config directories.
- With no command, the container now starts an HTTP server automatically when `PORT` is set or `AI_SYSTEM_SERVER_MODE=true`.
- The server exposes `GET /health`, synchronous `POST /run`, and queued `POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel`.
- `pnpm docker:up` and `make ai-up` are shortcuts for this repository only. They use this repo's `docker-compose.yml` and mount this repo into `/workspace`.
- If you want the same workflow inside another project, that project also needs a matching `docker-compose.yml` or a wrapper script that mounts that project's directory.
- The default memory backend `local-file` works out of the box because it stores data inside the mounted workspace.
- `OpenMemory` is not bundled into this image, but the app can talk to an existing OpenMemory server over HTTP.
- If OpenMemory is running on the host machine, use `AI_SYSTEM_OPENMEMORY_BASE_URL=http://host.docker.internal:9080` inside the container.
- If both services share a Docker network, set `AI_SYSTEM_OPENMEMORY_BASE_URL` to the service DNS name, for example `http://openmemory-openmemory-1:9080`.

## Notes

- The tool never sends the whole repository.
- It excludes common large or sensitive directories by default.
- CLI output is normalized through provider adapters, then validated against the expected schema.
- If a CLI emits invalid JSON, the tool attempts extraction and retries before failing.
- Provider timeouts and retries can be tuned per role. This is especially useful for large generator tasks where `codex` needs more than a minute.
- `codex` generator/fixer now default to `timeout_ms: 0`, which means no hard timeout. This avoids killing a large task that is close to finishing.
- Soft monitoring is enabled for long-running generator/fixer tasks by default. It emits heartbeat logs instead of killing the process.
- Project-scoped memory is stored locally under `.ai-system-memory/` by default.
- The default memory backend is vendor-neutral and local-first, so you can add OpenMemory later without changing the orchestrator.
- The OpenMemory backend supports both HTTP and `opm` CLI transports. HTTP is the better default when OpenMemory is already running in Docker.
- A generic `openai-compatible` provider is available, which lets you use 9router and other OpenAI-style routers without changing agent code.
- `claude-mem` can run alongside this project, but it is not the active backend unless you add a dedicated adapter for its worker API.
- Local validation is intentionally lightweight. The tool validates path safety and JSON syntax, but it does not guarantee project-level semantic correctness unless you add stronger validators.
- Default provider mapping is:
  - planner: `gemini-cli`
  - reviewer: `gemini-cli`
  - generator: `codex-cli`
  - fixer: `codex-cli`
