# Configuration Guide

Orchestra is highly configurable via project config files and environment variables. This guide covers all configuration options.

---

## Configuration Hierarchy

Orchestra loads configuration in this priority order (later overrides earlier):

1. **Built-in defaults** — Sensible defaults for all settings
2. **Global config** — `~/.ai-system/config.json` (user-level settings)
3. **Project config** — `.ai-system.json` in your repository root
4. **Environment variables** — `AI_SYSTEM_*` overrides
5. **CLI flags** — `--provider`, `--config`, etc.

---

## Project Configuration (`.ai-system.json`)

### Full Example

```json
{
  "tools": {
    "enabled": true,
    "json_validation": true,
    "sandbox": {
      "mode": "docker",
      "image_profile": "auto"
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
      "test": {
        "enabled": true,
        "command": "pnpm",
        "args": ["vitest", "run", "{changed_files}"]
      }
    }
  },

  "routing": {
    "enabled": true,
    "default_profile": "balanced",
    "profiles": {
      "balanced": {
        "planner": "gemini-cli",
        "generator": "codex-cli",
        "reviewer": "claude-cli",
        "fixer": "codex-cli"
      },
      "quality": {
        "planner": "claude-cli",
        "generator": "claude-cli",
        "reviewer": "claude-cli",
        "fixer": "claude-cli"
      }
    }
  },

  "vector_search": {
    "enabled": true,
    "data_dir": ".ai-system-vector"
  },

  "review": {
    "risk_policy": {
      "high_risk_patterns": ["**/auth/**", "**/security/**"],
      "require_approval": true,
      "min_review_severity": "medium"
    }
  },

  "prompts": {
    "directory": ".ai-system-prompts",
    "templates": {
      "reviewer": ".ai-system-prompts/strict-reviewer.md",
      "planner": ".ai-system-prompts/custom-planner.md"
    }
  },

  "auth": {
    "role_mapping": {
      "viewer": "viewer",
      "operator": "operator",
      "admin": "admin"
    },
    "action_permissions": {
      "queue.pause": "operator",
      "config.update": "admin",
      "work_item.create": "operator"
    }
  },

  "workspace": {
    "maxParallel": 2,
    "retentionDays": 30
  }
}
```

### Configuration Sections

#### `tools` — Verification Commands

| Field | Type | Description |
|---|---|---|
| `tools.enabled` | boolean | Enable/disable tool checks |
| `tools.json_validation` | boolean | Validate JSON output from AI |
| `tools.sandbox.mode` | `"inherit"` \| `"clean"` \| `"docker"` | Execution environment |
| `tools.sandbox.image_profile` | `"auto"` \| `"node"` \| `"python"` | Docker image selection |
| `tools.commands.<name>.enabled` | boolean | Enable specific check |
| `tools.commands.<name>.script` | string | npm script name to run |
| `tools.commands.<name>.command` | string | Direct command to run |
| `tools.commands.<name>.args` | string[] | Command arguments (`{changed_files}` is interpolated) |

#### `routing` — Provider Selection

| Field | Type | Description |
|---|---|---|
| `routing.enabled` | boolean | Enable dynamic routing |
| `routing.default_profile` | string | Default profile name |
| `routing.profiles.<name>` | object | Role-to-provider mapping |

#### `vector_search` — Semantic Code Search

| Field | Type | Description |
|---|---|---|
| `vector_search.enabled` | boolean | Enable vector search |
| `vector_search.data_dir` | string | Directory for index data |

#### `review` — Review & Risk Policy

| Field | Type | Description |
|---|---|---|
| `review.risk_policy.high_risk_patterns` | string[] | Glob patterns for high-risk files |
| `review.risk_policy.require_approval` | boolean | Require human approval for high-risk |
| `review.risk_policy.min_review_severity` | string | Minimum severity to flag |

#### `workspace` — Workspace Engine

| Field | Type | Description |
|---|---|---|
| `workspace.maxParallel` | number | Max concurrent work item executions |
| `workspace.retentionDays` | number | Days to keep completed work items |

---

## Provider Presets

Quickly switch between provider configurations:

```bash
ai config use <preset>
```

| Preset | Planner | Generator | Reviewer | Fixer |
|---|---|---|---|---|
| `codex-all` | codex-cli | codex-cli | codex-cli | codex-cli |
| `gemini-all` | gemini-cli | gemini-cli | gemini-cli | gemini-cli |
| `claude-all` | claude-cli | claude-cli | claude-cli | claude-cli |
| `hybrid` | gemini-cli | codex-cli | claude-cli | codex-cli |
| `safe-review` | gemini-cli | codex-cli | claude-cli | claude-cli |

---

## Environment Variables

### Provider Configuration

```bash
AI_SYSTEM_PROVIDER=gemini-cli         # Force specific provider for all roles
AI_SYSTEM_ROUTING_PROFILE=quality     # Force routing profile
AI_SYSTEM_ROUTING_ENABLED=false       # Disable dynamic routing
AI_SYSTEM_RISK_PROFILE=high           # Override risk profile
```

### API Keys & Models

```bash
AI_SYSTEM_9ROUTER_API_KEY=your-key
AI_SYSTEM_9ROUTER_MODEL=anthropic/claude-3-sonnet
AI_SYSTEM_9ROUTER_BASE_URL=https://api.example.com/v1
AI_SYSTEM_OPENMEMORY_BASE_URL=http://localhost:9080
```

### Runtime Behavior

```bash
AI_SYSTEM_MEMORY=local-file           # Memory backend
AI_SYSTEM_SANDBOX=docker              # Sandbox mode
AI_SYSTEM_MAX_ITERATIONS=5            # Max fix iterations
AI_SYSTEM_DISABLE_TUI=true            # Disable interactive UI
```

### Server

```bash
AI_SYSTEM_SERVER_MODE=true            # Enable server mode
AI_SYSTEM_SERVER_TOKEN=my-secret      # API auth token
PORT=3927                             # HTTP port (or AI_SYSTEM_PORT)
AI_SYSTEM_ALLOWED_WORKDIRS=/repo1,/repo2  # Allowed directories
```

---

## Prompt Customization

Override AI prompts by creating template files and referencing them in config:

```bash
mkdir .ai-system-prompts
```

```json
{
  "prompts": {
    "directory": ".ai-system-prompts",
    "templates": {
      "reviewer": ".ai-system-prompts/strict-reviewer.md",
      "planner": ".ai-system-prompts/domain-specific-planner.md"
    }
  }
}
```

Template files receive context variables via Mustache-style interpolation.

---

## Troubleshooting

### Check effective configuration

```bash
ai doctor
```

This shows the resolved configuration after merging all sources and validates that required providers are installed and accessible.

### Common issues

| Issue | Solution |
|---|---|
| "Provider not found" | Ensure the CLI is installed: `which gemini`, `which codex` |
| "Docker sandbox failed" | Check Docker is running: `docker info` |
| "Vector search slow" | First run builds the index; subsequent runs use cache |
| "Permission denied" | Check `AI_SYSTEM_ALLOWED_WORKDIRS` includes your repo |
