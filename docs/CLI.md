# CLI Reference

This document is the complete reference for the Orchestra CLI. The CLI is the primary interface for local development with Orchestra.

---

## Basic Usage

### Interactive Session (REPL)

```bash
ai                    # Start interactive mode
ai --chat             # Chat mode with memory
pnpm run ai:chat      # Same via npm script
```

### One-Shot Task

```bash
ai "Add retry handling to the API client"
ai "Refactor auth module to use refresh tokens" --no-dry-run
```

### Dry Run (Default)

By default, Orchestra runs in **dry-run mode** — it generates code and runs all checks, but does **not** write files to disk. This lets you preview changes safely.

```bash
ai "Add a loading state component"             # dry-run (safe preview)
ai "Add a loading state component" --no-dry-run  # actually write files
```

---

## Commands

### `ai implement "task"` — Full Implementation

The primary workflow: plan → generate → verify → auto-fix → review.

```bash
ai implement "Add pagination to the users API"
ai implement "Fix the login timeout bug" --no-dry-run
```

### `ai review` — Code Review

Reviews current working tree changes using the AI reviewer:

```bash
ai review                           # Review all uncommitted changes
ai review --staged                  # Review only staged changes
ai review --base main               # Review diff against a branch
ai review --files src/a.ts,src/b.ts # Review specific files
ai review --failing-checks          # Review and fix failing CI checks
```

### `ai fix` — Interactive Fix

Focus mode for fixing issues:

```bash
ai fix                              # Interactive fix session
ai fix-checks                       # Auto-run project checks and fix failures
```

### `ai retry` — Resume/Retry

Resume or retry a previous run from a specific stage:

```bash
ai retry last                       # Retry the most recent run
ai retry last --stage reviewing     # Retry from the review stage
ai retry <run-id>                   # Retry a specific run by ID
```

### `ai runs` — Artifact Browser

Browse and inspect execution artifacts:

```bash
ai runs list                        # List recent runs with status
ai runs list --limit 20             # Show more runs
```

### `ai config` — Configuration

Manage configuration and providers:

```bash
ai setup                            # Interactive setup wizard
ai doctor                           # Diagnose configuration issues
ai config show                      # Show effective configuration
ai config use <preset>              # Switch provider preset
```

**Available presets:**
| Preset | Description |
|---|---|
| `codex-all` | Use Codex for all roles |
| `gemini-all` | Use Gemini for all roles |
| `claude-all` | Use Claude for all roles |
| `hybrid` | Gemini for planning/review, Codex for generation |
| `safe-review` | Enhanced review settings for high-risk changes |

### `ai work` — Workspace Commands

Manage durable work items for multi-step engineering tasks:

```bash
ai work list                                          # List all work items
ai work create "Add user authentication"              # Create work item
ai work assess <id>                                   # Run risk assessment
ai work run <id>                                      # Execute next graph node
ai work cancel <id>                                   # Cancel execution
ai work inbox import https://github.com/org/repo/issues/42  # Import from GitHub
ai work ci-watch <id>                                 # Watch PR CI status
ai work metrics                                       # Show workspace metrics
```

---

## Flags & Options

| Flag | Description |
|---|---|
| `--dry-run` / `--no-dry-run` | Toggle dry-run mode (default: on) |
| `--interactive` | Enable interactive confirmation prompts |
| `--pause-after-plan` | Pause after planning for human review |
| `--pause-after-generate` | Pause after generation for human review |
| `--config <path>` | Use specific config file |
| `--global-config` | Use global config (ignore project config) |
| `--provider <preset>` | Force a provider preset |
| `--output-json` | Output result as JSON |
| `--save <path>` | Save output to a file |
| `--force` | Skip safety confirmations |
| `--help` | Show help |

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AI_SYSTEM_PROVIDER` | Force a specific provider (`gemini-cli`, `codex-cli`, `claude-cli`, `9router`) | Auto-detected |
| `AI_SYSTEM_ROUTING_PROFILE` | Force routing profile (`balanced`, `quality`, `speed`, `cost`) | `balanced` |
| `AI_SYSTEM_ROUTING_ENABLED` | Enable/disable dynamic routing | `true` |
| `AI_SYSTEM_RISK_PROFILE` | Override risk profile | None |
| `AI_SYSTEM_MEMORY` | Memory backend (`off`, `local-file`, `openmemory`) | `local-file` |
| `AI_SYSTEM_SANDBOX` | Sandbox mode (`inherit`, `clean`, `docker`) | `inherit` |
| `AI_SYSTEM_DISABLE_TUI` | Disable interactive dashboard | `false` |
| `AI_SYSTEM_MAX_ITERATIONS` | Max fix iterations | `5` |
| `AI_SYSTEM_9ROUTER_API_KEY` | API key for 9router provider | None |
| `AI_SYSTEM_9ROUTER_MODEL` | Model for 9router | None |
| `AI_SYSTEM_OPENMEMORY_BASE_URL` | OpenMemory backend URL | None |

---

## Workflow Modes

Orchestra supports different workflow modes that adjust the execution pipeline:

| Mode | Behavior |
|---|---|
| `standard` | Full pipeline: plan → generate → verify → review |
| `review` | Review-only: analyze changes, no code generation |
| `fix` | Fix-focused: start from existing issues, iterate to fix |

---

## Examples

### Full implementation with file output

```bash
ai implement "Add rate limiting middleware to Express app" \
  --no-dry-run \
  --output-json \
  --save result.json
```

### Review a PR branch

```bash
ai review --base main --files $(git diff --name-only main)
```

### Import a GitHub issue and start work

```bash
ai work inbox import https://github.com/myorg/myrepo/issues/42
ai work assess wi-1
ai work run wi-1
```
