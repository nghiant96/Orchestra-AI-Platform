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

## Setup

Log into the CLIs you plan to use:

```bash
gemini
codex login
# optional
claude
```

## Quick Start

There are now two recommended local setup modes:

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

Use project-level config:

```bash
cp .ai-system.json.example .ai-system.json
ai --chat
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
AI_SYSTEM_REVIEWER_PROVIDER=claude-cli npm run ai -- --dry-run "Review the generated hook changes"
AI_SYSTEM_MEMORY=off npm run ai -- --dry-run "Refactor the auth flow"
AI_SYSTEM_MEMORY=openmemory \
AI_SYSTEM_OPENMEMORY_BASE_URL=http://127.0.0.1:8080 \
npm run ai -- --dry-run "Refactor the auth flow"
AI_SYSTEM_GENERATOR_TIMEOUT_MS=480000 AI_SYSTEM_FIXER_TIMEOUT_MS=300000 pnpm run ai -- "Tách project hiện tại thành dự án mới với tên Edura+"
AI_SYSTEM_GENERATOR_TIMEOUT_MS=0 AI_SYSTEM_FIXER_TIMEOUT_MS=0 pnpm run ai -- "Tách project hiện tại thành dự án mới với tên Edura+"
AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS=60000 \
AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS=60000 \
pnpm run ai -- "Tách project hiện tại thành dự án mới với tên Edura+"
```

Review the AI plan before it generates code:

```bash
ai --interactive "Refactor the auth flow"
```

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

Then call the service:

```bash
curl -X POST http://127.0.0.1:3927/run \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{"task":"Implement retry handling for the API client","dryRun":true}'
```

## Configuration Reference

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
- `.env` is auto-loaded from the target repository root when present

## Container Notes

- The image bundles `gemini`, `codex`, and `claude` CLIs via their npm packages.
- Authentication is expected to come from mounted CLI config directories.
- With no command, the container now starts an HTTP server automatically when `PORT` is set or `AI_SYSTEM_SERVER_MODE=true`.
- The server exposes `GET /health` and `POST /run`.
- `pnpm docker:up` and `make ai-up` are shortcuts for this repository only. They use this repo's `docker-compose.yml` and mount this repo into `/workspace`.
- If you want the same workflow inside another project, that project also needs a matching `docker-compose.yml` or a wrapper script that mounts that project's directory.
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
- A generic `openai-compatible` provider is available, which lets you use 9router and other OpenAI-style routers without changing agent code.
- `claude-mem` can run alongside this project, but it is not the active backend unless you add a dedicated adapter for its worker API.
- Local validation is intentionally lightweight. The tool validates path safety and JSON syntax, but it does not guarantee project-level semantic correctness unless you add stronger validators.
- Default provider mapping is:
  - planner: `gemini-cli`
  - reviewer: `gemini-cli`
  - generator: `codex-cli`
  - fixer: `codex-cli`
