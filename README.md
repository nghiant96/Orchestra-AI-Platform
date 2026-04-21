# AI Coding System

A local CLI-first coding system that uses installed AI CLIs instead of direct API key integrations.

## What it does

- Builds a safe directory tree for a target repository
- Lets a planner provider choose a small set of relevant files
- Sends only those files to a generator provider for full-file generation
- Runs a review and fix loop up to a configured maximum
- Retrieves relevant project memory before planning and implementation
- Writes accepted files atomically

## Requirements

- Node.js 20+ recommended, tested on Node.js 24
- Installed and authenticated AI CLIs for the providers you want to use
- Defaults assume:
  - `gemini` is installed for planner/reviewer
  - `codex` is installed for generator/fixer

Optional alternate provider:

- `claude`

Optional environment variables:

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

## Setup

Log into the CLIs you plan to use:

```bash
gemini
codex login
# optional
claude
```

## Usage

Run against the current directory:

```bash
npm run ai -- "Add retry handling to the API client"
```

Run against another repository:

```bash
npm run ai -- --cwd /absolute/path/to/repo "Refactor the auth hook to handle refresh tokens"
```

Preview without writing files:

```bash
npm run ai -- --dry-run "Add a reusable loading state component"
```

Switch a role to Claude via environment override:

```bash
AI_SYSTEM_REVIEWER_PROVIDER=claude-cli npm run ai -- --dry-run "Review the generated hook changes"
```

Disable memory for a run:

```bash
AI_SYSTEM_MEMORY_ENABLED=false npm run ai -- --dry-run "Refactor the auth flow"
```

Use OpenMemory as the memory backend over HTTP:

```bash
AI_SYSTEM_MEMORY_BACKEND=openmemory \
AI_SYSTEM_MEMORY_TRANSPORT=http \
AI_SYSTEM_OPENMEMORY_BASE_URL=http://127.0.0.1:8080 \
npm run ai -- --dry-run "Refactor the auth flow"
```

Increase generator timeout for larger refactors:

```bash
AI_SYSTEM_GENERATOR_TIMEOUT_MS=480000 AI_SYSTEM_FIXER_TIMEOUT_MS=300000 pnpm run ai -- "Tách project hiện tại thành dự án mới với tên Edura+"
```

Disable `codex` timeout completely for long-running tasks:

```bash
AI_SYSTEM_GENERATOR_TIMEOUT_MS=0 AI_SYSTEM_FIXER_TIMEOUT_MS=0 pnpm run ai -- "Tách project hiện tại thành dự án mới với tên Edura+"
```

Keep long-running providers visible without killing them:

```bash
AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS=60000 \
AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS=60000 \
pnpm run ai -- "Tách project hiện tại thành dự án mới với tên Edura+"
```

## Docker

Build the image:

```bash
docker build -t ai-coding-system:local .
```

Run against the current repository mounted at `/workspace`:

```bash
docker run --rm -it \
  -v "$PWD:/workspace" \
  -v "$HOME/.gemini:/root/.gemini" \
  -v "$HOME/.codex:/root/.codex" \
  -v "$HOME/.claude:/root/.claude" \
  ai-coding-system:local \
  --dry-run "Add a reusable loading state component"
```

Use Docker Compose locally:

```bash
docker compose run --rm ai-coding-system --dry-run "Refactor the auth flow"
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

Notes for container usage:

- The image bundles `gemini`, `codex`, and `claude` CLIs via their npm packages.
- Authentication is expected to come from mounted CLI config directories.
- The default memory backend `local-file` works out of the box because it stores data inside the mounted workspace.
- `OpenMemory` is not bundled into this image, but the app can talk to an existing OpenMemory server over HTTP.
- If OpenMemory is running on the host machine, use `AI_SYSTEM_OPENMEMORY_BASE_URL=http://host.docker.internal:8080` inside the container.
- If both services share a Docker network, set `AI_SYSTEM_OPENMEMORY_BASE_URL` to the service DNS name, for example `http://openmemory-openmemory-1:8080`.

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
- `claude-mem` can run alongside this project, but it is not the active backend unless you add a dedicated adapter for its worker API.
- Local validation is intentionally lightweight. The tool validates path safety and JSON syntax, but it does not guarantee project-level semantic correctness unless you add stronger validators.
- Default provider mapping is:
  - planner: `gemini-cli`
  - reviewer: `gemini-cli`
  - generator: `codex-cli`
  - fixer: `codex-cli`
