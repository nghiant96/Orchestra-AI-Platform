import type { InteractiveState } from "../types.js";

export function printInteractiveBanner(state: InteractiveState): void {
  console.log("AI Coding System");
  console.log(`- cwd: ${state.cwd}`);
  console.log(`- dry-run: ${state.dryRun}`);
  console.log(`- plan approval: ${state.interactive}`);
  console.log(`- pause after plan: ${state.pauseAfterPlan}`);
  console.log(`- pause after generate: ${state.pauseAfterGenerate}`);
  console.log(`- provider preset: ${state.providerPreset ?? "(default)"}`);
  console.log(`- resume target: ${state.resumeTarget ?? "(none)"}`);
  console.log(`- config: ${state.configPath ?? "(auto .ai-system.json)"}`);
  console.log("Type a task and press Enter. Use /help for session commands.");
}

export function printInteractiveHelp(): void {
  console.log("");
  console.log("Session commands");
  console.log("- /help");
  console.log("- /status");
  console.log("- /dry-run");
  console.log("- /dry-run off");
  console.log("- /interactive");
  console.log("- /interactive off");
  console.log("- /pause-plan");
  console.log("- /pause-plan off");
  console.log("- /pause-generate");
  console.log("- /pause-generate off");
  console.log("- /manual-review");
  console.log("- /manual-review off");
  console.log("- /resume /absolute/or/relative/path/to/run-or-run-state.json");
  console.log("- /resume-last");
  console.log("- /resume clear");
  console.log("- /provider local-cli|9router|openai-compatible|gemini-cli|claude-cli|codex-cli");
  console.log("- /provider clear");
  console.log("- /cwd /absolute/or/relative/path");
  console.log("- /config /absolute/or/relative/path/to/config.json");
  console.log("- /config clear");
  console.log("- /exit");
}

export function printSessionStatus(state: InteractiveState): void {
  console.log("");
  console.log("Session");
  console.log(`- cwd: ${state.cwd}`);
  console.log(`- dry-run: ${state.dryRun}`);
  console.log(`- plan approval: ${state.interactive}`);
  console.log(`- pause after plan: ${state.pauseAfterPlan}`);
  console.log(`- pause after generate: ${state.pauseAfterGenerate}`);
  console.log(`- provider preset: ${state.providerPreset ?? "(default)"}`);
  console.log(`- resume target: ${state.resumeTarget ?? "(none)"}`);
  console.log(`- config: ${state.configPath ?? "(auto .ai-system.json)"}`);
}

export function printHelp(): void {
  console.log(`Usage:
  ai "task description"
  ai implement "task description"
  ai review "task description"
  ai review --staged
  ai review --base main
  ai review --failing-checks
  ai review --files src/auth.ts,src/session.ts
  ai review --staged --files src/auth.ts
  ai review --base main --files src/auth.ts
  ai fix "task description"
  ai fix --from-run last
  ai fix-checks
  ai retry last --stage reviewing
  ai explain-routing "task description"
  ai explain-routing
  ai runs latest
  ai runs list
  ai runs show last
  ai runs show last --json
  ai review --json --save /tmp/review.json
  ai runs show last --json --save /tmp/run.json
  ai apply --from-artifact last
  ai setup
  ai setup --global
  ai setup --check
  ai config show
  ai config show --global
  ai config use codex-all
  ai config use codex-all --global
  ai doctor
  ai doctor --global
  ai --cwd /path/to/repo --dry-run "task description"
  ai --interactive "task description"
  ai --pause-after-plan "task description"
  ai --pause-after-generate "task description"
  ai --manual-review "task description"
  ai --resume /path/to/.ai-system-artifacts/run-.../
  ai --resume-last
  ai --provider 9router "task description"
  ai --9router --chat
  ai --chat

Examples:
  ai "Refactor the auth flow"
  ai implement "Refactor the auth flow"
  ai review "Propose and review auth changes"
  ai review --staged
  ai review --base main
  ai review --failing-checks
  ai review --files src/auth.ts --json --save /tmp/review.json
  ai review --staged --files src/auth.ts --json --save /tmp/staged-scope-review.json
  ai fix "Fix the auth flow regression"
  ai fix --from-run last
  ai fix-checks
  ai retry last --stage reviewing
  ai explain-routing "Refactor the auth flow"
  ai explain-routing
  ai runs latest
  ai runs list
  ai runs show run-2026-...
  ai runs show last --json
  ai review --json --save /tmp/review.json
  ai runs show last --json --save /tmp/run.json
  ai apply --from-artifact last
  ai setup
  ai setup --global
  ai setup --check
  ai config show
  ai config show --global
  ai config use codex-all
  ai config use codex-all --global
  ai doctor
  ai doctor --global
  ai --dry-run "Add a reusable loading state component"
  ai --interactive "Review the plan before changing files"
  ai --pause-after-plan "Pause after planner checkpoint"
  ai --pause-after-generate "Pause before AI review"
  ai --manual-review "Let me inspect every major checkpoint"
  ai --resume-last
  ai --provider 9router --dry-run "Refactor the auth flow"
  ai --cwd /absolute/path/to/repo "Implement retry handling"
  ai --config .ai-system.json --chat
  echo "Fix retry handling in api client" | ai

Interactive mode:
  Run \`ai\` with no task to open a session, similar to Gemini CLI.
  Use --chat explicitly if you want chat mode.
  Use --interactive to confirm the AI plan before changes are generated.
  Use --pause-after-plan to stop after the planner checkpoint.
  Use --pause-after-generate to stop after each generated candidate is saved.
  Use --manual-review to enable plan approval plus both pause checkpoints.
  Use --resume or --resume-last to continue a paused run from checkpoint artifacts.

Workflow modes:
  Use \`ai implement "task"\` for the standard write-enabled flow.
  Use \`ai review\` to review current working tree changes when the repo is dirty.
  Use \`ai review --staged\` to review only what is currently staged in git.
  Use \`ai review --base <git-ref>\` to review the current repo state against a base ref such as \`main\` or \`origin/main\`.
  Use \`ai review --failing-checks\` to review the code regions implicated by the currently failing repo checks.
  Use \`ai review --files <path[,path2...]>\` (or repeat \`--files\`) to review only the requested file scope against \`HEAD\`.
  You can combine \`--files\` with \`--staged\` or \`--base <git-ref>\` to review only a precise subset within that git scope.
  Use \`ai review "task"\` for a dry-run review flow with plan approval and a generation checkpoint when there are no current changes.
  Use \`ai fix "task"\` for an interactive fix-focused flow that still writes files when approved.
  Use \`ai fix-checks\` to run the configured repo checks, turn failing output into a structured repair task, and execute the normal fix loop against it.
  Use \`ai fix --from-run <target>\` to continue from a previous run, resuming directly when possible or building a focused follow-up repair task when not.
  Use \`ai retry <target> --stage <stage>\` to force a retry from a specific state-machine stage such as \`reviewing\`, \`fixing\`, or \`writing\`.

Provider presets:
  --provider local-cli
  --provider 9router
  --provider openai-compatible
  --provider gemini-cli
  --provider claude-cli
  --provider codex-cli
  --9router is a shortcut for --provider 9router

Project config:
  The CLI auto-loads .ai-system.json from the current repo when present.
  The CLI also auto-loads a global config from ~/.config/ai-system/config.json when present.
  You can override it with --config /path/to/config.json
  Use \`ai setup\` for an interactive setup wizard.
  Use \`ai setup --global\` to write global defaults used across repos.
  Use \`ai setup --check\` to validate CLIs and OpenMemory connectivity.
  Use \`ai config use codex-all|hybrid|safe-review\` to set a project preset.
  Add \`--global\` to \`ai config show\`, \`ai config use\`, or \`ai doctor\` to inspect or write the global config layer directly.
  Use \`ai config show\` to inspect the effective config after preset/env merges.
  Use \`ai doctor\` to explain overrides and likely sources of surprising behavior.
  Use \`ai explain-routing "task"\` to see why the current config would choose specific providers.
  Use \`ai explain-routing\` with no task to inspect routing from the latest artifact-backed run.
  Use \`ai runs latest\` to inspect the newest artifact-backed run without opening JSON files manually.
  Use \`ai runs list\` to browse recent runs quickly.
  Use \`ai runs show <target>\` to inspect a specific run directory or run-state file.
  Use \`ai apply --from-artifact <target>\` to apply a saved candidate without rerunning generation.
  Add \`--force\` if you intentionally want to apply a candidate with blocking review issues.
  Add \`--json\` to \`ai runs ...\`, \`ai review\`, or \`ai apply --from-artifact\` when you want machine-readable output.
  Add \`--save /path/to/file.json\` together with \`--json\` when you want the CLI to write the JSON payload directly to disk.

Environment overrides:
  AI_SYSTEM_PROVIDER=local-cli|9router|openai-compatible|gemini-cli|claude-cli|codex-cli
  AI_SYSTEM_MEMORY=local|openmemory|off
  AI_SYSTEM_PLANNER_PROVIDER=gemini-cli|claude-cli|openai-compatible
  AI_SYSTEM_REVIEWER_PROVIDER=gemini-cli|claude-cli|openai-compatible
  AI_SYSTEM_GENERATOR_PROVIDER=codex-cli|claude-cli|openai-compatible
  AI_SYSTEM_FIXER_PROVIDER=codex-cli|claude-cli|openai-compatible
  AI_SYSTEM_GENERATOR_TIMEOUT_MS=0    # disable timeout
  AI_SYSTEM_FIXER_TIMEOUT_MS=0        # disable timeout
  AI_SYSTEM_GENERATOR_MONITOR_INTERVAL_MS=60000
  AI_SYSTEM_FIXER_MONITOR_INTERVAL_MS=60000
  AI_SYSTEM_GENERATOR_RETRIES=1
  AI_SYSTEM_FIXER_RETRIES=1
  AI_SYSTEM_ROUTING_ENABLED=true|false
  AI_SYSTEM_ROUTING_PROFILE=fast|balanced|safe
  AI_SYSTEM_RISK_PROFILE=low|medium|high
  AI_SYSTEM_MEMORY_ENABLED=true|false
  AI_SYSTEM_MEMORY_BACKEND=local-file|openmemory
  AI_SYSTEM_MEMORY_TRANSPORT=http|cli
  AI_SYSTEM_OPENMEMORY_BASE_URL=http://127.0.0.1:8080
  AI_SYSTEM_BASE_URL=http://127.0.0.1:20128/v1
  AI_SYSTEM_API_KEY=...
  AI_SYSTEM_MODEL=model-from-your-9router-dashboard
  AI_SYSTEM_OPENAI_BASE_URL=http://127.0.0.1:20128/v1
  AI_SYSTEM_OPENAI_API_KEY=...
  AI_SYSTEM_OPENAI_MODEL=model-from-your-9router-dashboard
  AI_SYSTEM_9ROUTER_BASE_URL=http://127.0.0.1:20128/v1
  AI_SYSTEM_9ROUTER_API_KEY=...
  AI_SYSTEM_9ROUTER_MODEL=model-from-your-9router-dashboard
`);
}
