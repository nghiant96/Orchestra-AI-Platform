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
- `AI_SYSTEM_MEMORY_ENABLED`
- `AI_SYSTEM_MEMORY_BACKEND`

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

Use OpenMemory as the memory backend:

```bash
# Requires OpenMemory's opm CLI and a running OpenMemory service
AI_SYSTEM_MEMORY_BACKEND=openmemory npm run ai -- --dry-run "Refactor the auth flow"
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
- `OpenMemory` is not bundled into this image. If you want `AI_SYSTEM_MEMORY_BACKEND=openmemory`, make sure `opm` and the OpenMemory service are available in the container or extend the image.

## Notes

- The tool never sends the whole repository.
- It excludes common large or sensitive directories by default.
- CLI output is normalized through provider adapters, then validated against the expected schema.
- If a CLI emits invalid JSON, the tool attempts extraction and retries before failing.
- Project-scoped memory is stored locally under `.ai-system-memory/` by default.
- The default memory backend is vendor-neutral and local-first, so you can add OpenMemory later without changing the orchestrator.
- An OpenMemory backend is also available through the official `opm` CLI. It uses `opm health`, `opm query`, and `opm add`.
- Local validation is intentionally lightweight. The tool validates path safety and JSON syntax, but it does not guarantee project-level semantic correctness unless you add stronger validators.
- Default provider mapping is:
  - planner: `gemini-cli`
  - reviewer: `gemini-cli`
  - generator: `codex-cli`
  - fixer: `codex-cli`
