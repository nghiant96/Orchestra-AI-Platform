# CLI Guide

This document describes how to use the Orchestra CLI for local development.

## Basic Usage

Start an interactive session:
```bash
ai
# or
pnpm run ai:chat
```

Run a one-shot task:
```bash
ai "Add retry handling to the API client"
```

Preview changes without writing files:
```bash
ai --dry-run "Add a reusable loading state component"
```

## Subcommands

| Command | Description |
| :--- | :--- |
| `ai implement "task"` | Full implementation loop: plan -> implement -> checks -> auto-fix. |
| `ai review` | Review current working tree changes. |
| `ai fix` | Interactive fix-focused flow. |
| `ai fix-checks` | Run project checks and auto-repair failures. |
| `ai setup` | Interactive configuration of providers and project settings. |
| `ai doctor` | Inspect effective configuration and troubleshoot issues. |
| `ai runs list` | Browse recent execution artifacts. |
| `ai work list` | Manage durable Work Items. |

## Advanced Workflows

### Target specific files
```bash
ai review --files src/auth.ts,src/session.ts
```

### Review staged changes
```bash
ai review --staged
```

### Resume/Retry
```bash
ai retry last --stage reviewing
```

## Environment Overrides

| Variable | Description |
| :--- | :--- |
| `AI_SYSTEM_PROVIDER` | Force a specific provider (e.g., `gemini-cli`, `9router`). |
| `AI_SYSTEM_MEMORY` | Toggle memory backend (`off`, `local-file`, `openmemory`). |
| `AI_SYSTEM_DISABLE_TUI` | Set to `true` to disable the interactive dashboard. |
