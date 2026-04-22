# Task Todo

Use this file for non-trivial work that benefits from an explicit execution plan.

## Active Task

Task: Add a global configuration layer so provider and memory defaults can apply across projects without reconfiguring each repository.

- [x] Define the current task
- [x] Inspect current config resolution and precedence
- [x] Add automatic global config loading before project config
- [x] Extend CLI commands so setup/config/doctor can work against the global config too
- [x] Add tests for global-vs-project precedence and verify end-to-end

## Review

- Result: Completed.
- Verification:
  - Passed `pnpm exec tsc --noEmit`
  - Passed `pnpm test -- config-workflow orchestrator-runtime`
  - Passed `node --import tsx ./bin/ai.js doctor --global`
- Notes: Config precedence is now `internal defaults -> global config -> project config -> env overrides`. `ai setup` remains role-based, supports `auto` per role, and explicit roles are locked against dynamic routing while `auto` roles remain routable. `--global` on setup/config/doctor targets the global config layer directly at `~/.config/ai-system/config.json`.
