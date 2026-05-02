# Orchestra AI Platform

**Local-first control plane for AI coding agents.**

Turn Codex, Gemini, and Claude CLIs into a coordinated, governed coding workflow with planning, automated checks, self-repair loops, and human-in-the-loop approvals.

[![Security](https://img.shields.io/badge/security-local--first-blue)](docs/SECURITY.md)
[![License](https://img.shields.io/badge/license-Private-red)](#)

## Why Orchestra?

Orchestra isn't just another AI chatbot. It's a **Work Executor** that manages the entire lifecycle of a coding task:

1.  **Plan:** Analyzes your repo and chooses only the relevant files.
2.  **Execute:** Uses your installed AI CLIs to generate full-file patches.
3.  **Verify:** Runs your project's `lint`, `typecheck`, and `test` scripts automatically.
4.  **Repair:** If checks fail, it enters an auto-fix loop until the code is "green".
5.  **Review:** Performs a multi-layered AI review before asking for your approval.
6.  **Deliver:** Writes files atomically or creates branch-based Pull Requests.

## Quick Start

### 1. Install & Login
Ensure you have your preferred AI CLIs installed:
```bash
gemini
codex login
# optional
claude
```

### 2. Run a task
```bash
ai "Refactor the auth flow to handle refresh tokens"
```

## Documentation

- [**CLI Guide**](docs/CLI.md) - Full list of commands and workflows.
- [**Server & Dashboard**](docs/SERVER.md) - Running Orchestra as a team control plane.
- [**Configuration**](docs/CONFIG.md) - Customizing providers, routing, and tool checks.
- [**Workspace & Work Items**](docs/WORKSPACE.md) - Managing complex, multi-step tasks.
- [**Security Policy**](docs/SECURITY.md) - How we protect your code and credentials.
- [**Architecture**](docs/ARCHITECTURE.md) - Under the hood of the Orchestra runtime.

## Safety & Reliability

- **Dry-run by default:** Preview changes without touching a single file.
- **Artifact-backed:** Every iteration is saved under `.ai-system-artifacts/`. Rollback anytime.
- **Checkpoints:** Pause after planning or generation to verify intent.
- **Sandboxed Execution:** Run project checks inside Docker for isolation.

## Requirements

- Node.js 20+ (tested on Node 24)
- `pnpm`
- Installed AI CLIs for your chosen providers.
