# Configuration Guide

Orchestra is highly configurable via `.ai-system.json` and environment variables.

## Project Configuration (`.ai-system.json`)

Example configuration for tool checks and sandboxing:

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
  "vector_search": {
    "enabled": true,
    "data_dir": ".ai-system-vector"
  }
}
```

## Provider Presets

Use `ai config use <preset>` to switch between built-in configurations:

- `codex-all`: Use Codex for all roles.
- `hybrid`: Use Gemini for planning/review and Codex for generation.
- `safe-review`: Enhanced review settings for high-risk changes.

## Environment Variables

Put secrets and host-specific values in a `.env` file in your repository root.

```bash
AI_SYSTEM_9ROUTER_API_KEY=your-key
AI_SYSTEM_9ROUTER_MODEL=anthropic/claude-3-sonnet
AI_SYSTEM_OPENMEMORY_BASE_URL=http://localhost:9080
```

## Prompt Customization

You can override the built-in AI prompts by creating a `.ai-system-prompts` directory and configuring it in your JSON:

```json
{
  "prompts": {
    "directory": ".ai-system-prompts",
    "templates": {
      "reviewer": ".ai-system-prompts/strict-reviewer.md"
    }
  }
}
```
