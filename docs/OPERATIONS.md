# Operations And API Guide

Last updated: 2026-04-30

This guide covers the local HTTP service and dashboard workflows for operating the AI Coding System (v0.9+).

## Start The Service

Run the server from the repository root:

```bash
pnpm run server
```

`pnpm run server` reads a repo-root `.env` file before startup, so you can place `AI_SYSTEM_SERVER_TOKEN` there instead of exporting it in the shell.

For multi-project operation, set `AI_SYSTEM_ALLOWED_WORKDIRS` to a comma-separated list of absolute repository paths. Requests with `cwd` outside those roots are rejected.

```bash
AI_SYSTEM_ALLOWED_WORKDIRS="/repo/a,/repo/b" pnpm run server
```

Run the dashboard in another shell:

```bash
pnpm run dashboard:dev
```

### One-Command Local Start

For local development and testing, you can start both the server and dashboard with a single command:

```bash
pnpm run local:dev
```

This starts the server and dashboard together. Put `AI_SYSTEM_SERVER_TOKEN` in the repo-root `.env` file so both processes use the same token source.

## Authentication And Roles

When `AI_SYSTEM_SERVER_TOKEN` is configured, all API routes including `/health` and `/logs` require the bearer token.

Role-sensitive write actions read actor headers through `parseAuditActor`:

- Viewer: can read project, job, stats, audit, config, and lesson data.
- Operator: can create jobs, approve/reject, pause/resume/clear queue, cancel/resume/retry jobs, and create lessons.
- Admin: can update config.

All operator/admin actions should create audit events.

## Core API Routes

`GET /health`

Returns server status, cwd, allowed workdirs, queue counts, and effective approval policy summary.

`GET /projects`

Returns the configured project registry for allowed workdirs.

`GET /jobs?cwd=/absolute/repo`

Returns active queue jobs merged with recent artifact-backed runs for the requested project.

`POST /jobs`

Creates a queued job. Body:

```json
{
  "task": "Fix queue approval behavior",
  "cwd": "/absolute/repo",
  "dryRun": true
}
```

The server resolves risk policy at enqueue time and persists `approvalMode` plus `approvalPolicy` on the job.

`GET /jobs/:jobId`

Returns a queue job or artifact-backed run summary.

`POST /jobs/:jobId/approve`

Approves the current pending checkpoint for a waiting job.

`POST /jobs/:jobId/reject`

Rejects the current pending checkpoint and lets the run stop.

`POST /jobs/:jobId/cancel`

Cancels a queued/running/waiting job when possible.

`POST /jobs/:jobId/resume`

Requeues a failed or cancelled job with resume enabled.

`POST /jobs/:jobId/retry`

Creates a fresh job from the previous job task, cwd, and dry-run mode.

`GET /jobs/:jobId/files/content?cwd=/absolute/repo&path=src/file.ts&type=generated`

Returns generated or original file content from the latest iteration artifacts.

`POST /run`

Runs a synchronous dry-run style execution and returns the result directly. Prefer `/jobs` for dashboard operation.

`GET /config`

Returns the effective project config with secrets masked.

`POST /config`

Admin-only config update. The body is merged into the project `.ai-system.json`.

`GET /stats?cwd=/absolute/repo`

Returns artifact-derived analytics, including provider performance and cost trends.

`GET /lessons?cwd=/absolute/repo`

Returns saved project lessons and proposed lessons from recent repeated failure classes.

`POST /lessons`

Operator-only lesson creation. Body:

```json
{
  "cwd": "/absolute/repo",
  "title": "Preserve queue IDs",
  "body": "Queue retries must retain source job traceability in audit details."
}
```

`GET /audit?limit=100`

Returns recent audit events.

`POST /queue/pause`

Pauses queue processing.

`POST /queue/resume`

Resumes queue processing.

`POST /queue/clear-finished`

Deletes completed, failed, and cancelled queue records.

## Approval Policy

Approval policy is resolved from task text, config, paths, generated file count, and estimated diff size.

- Low risk: auto-runs with standard checks.
- Medium risk: pauses after plan.
- High risk: pauses after generation and uses strict review.
- Blocked: requires explicit manual approval before write.

`skip_approval=true` can permit auto-run for low-risk work, but blocked risk still requires manual approval.

## Artifact And Project Isolation

Each project cwd resolves its own rules, artifacts, queue view, run summaries, lessons, and analytics. Requests with a `cwd` must stay under `AI_SYSTEM_ALLOWED_WORKDIRS`; otherwise the server returns 403.

Use `/projects` first in dashboard or automation clients, then pass the selected project cwd to `/jobs`, `/stats`, and `/lessons`.

## Release Smoke Checklist

Run these before treating a build as an internal release candidate:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run dashboard:build
pnpm --dir dashboard test
pnpm audit --audit-level high --registry https://registry.npmjs.org
git diff --check
```

Then perform a local server smoke:

1. Start `pnpm run server` with `AI_SYSTEM_SERVER_MODE=true` and `AI_SYSTEM_SERVER_TOKEN` set.
2. Call `GET /health` and confirm `ok=true`.
3. Call `GET /projects` and confirm every expected workdir appears.
4. Submit a low-risk dry-run job through `POST /jobs`.
5. Confirm it appears in `GET /jobs?cwd=...`.
6. If it pauses, approve or reject it from the dashboard and confirm an audit event appears.
7. Open the dashboard and verify Project Health, Activity Feed, Job Detail, Config, Analytics, and Lessons load for the selected project.

## Operator Runbook

### Setup Modes

#### Local CLI Mode (Default)
Uses installed and authenticated CLIs (`gemini`, `codex`, `claude`) directly.
- **Prerequisites:** CLIs must be in PATH and logged in.
- **Usage:** `ai "task"`
- **Benefit:** Fast, zero-config for secrets.

#### Hybrid Provider Mode
Mixes local CLIs for planning/review with cloud providers for generation.
- **Config:** Use `ai config use hybrid` or see `.ai-system.hybrid.json.example`.
- **Benefit:** Balances cost and performance.

#### 9router / OpenAI Mode
Routes all requests through a central OpenAI-compatible provider.
- **Config:** See `.ai-system.9router.json.example`.
- **Env:** Requires `AI_SYSTEM_API_KEY` and `AI_SYSTEM_BASE_URL`.
- **Benefit:** Unified billing and model selection.

#### Server & Dashboard Mode
Runs as a background service with a web UI.
- **Startup:** `AI_SYSTEM_SERVER_MODE=true AI_SYSTEM_SERVER_TOKEN=... pnpm run server`
- **Dashboard:** `pnpm run dashboard:dev`
- **Benefit:** Multi-project management, auditability, and async execution.

### Operational Tasks

#### Queue Recovery
If the server crashes, queued and running jobs remain in `.ai-system-server/jobs`.
- **Restart:** The server will automatically detect existing jobs.
- **Resume:** Failed jobs can be resumed from their last successful stage via `POST /jobs/:id/resume` or the dashboard "Resume" button.

#### Artifact Cleanup
Artifacts are stored in `.ai-system-artifacts/` within each project.
- **Manual Cleanup:** Safe to delete old run directories if history is no longer needed.
- **Automation:** (Planned for v1.0) Automatic retention policy.

#### Audit Review
All operator actions are logged.
- **View:** `GET /audit` or the "Audit Log" tab in the dashboard.
- **Details:** Includes actor, action, timestamp, and metadata (job IDs, config changes).

#### Lessons Workflow
Improve system behavior by capturing corrections.
- **Capture:** After a job, if the AI missed a requirement, create a lesson in the dashboard or via `ai lessons add`.
- **Effect:** Lessons are injected into future planning phases for the same project.

### Common Failures & Next Actions

| Failure Class | Likely Cause | Next Action |
| :--- | :--- | :--- |
| `provider_error` | CLI not logged in or API quota exceeded. | Run `ai setup --check` or verify API credits. |
| `validation_failed` | AI generated invalid JSON or code. | Check "Fix Iterations" in Job Detail; increase `max_iterations`. |
| `budget_exceeded` | Task too large or AI stuck in a loop. | Increase budget in config or break task into smaller steps. |
| `check_failed` | Lint/Typecheck failed and auto-fix failed. | Review the diff and fix manually, or refine the task instructions. |
| `unauthorized` | Missing or invalid `AI_SYSTEM_SERVER_TOKEN`. | Check `.env` and bearer token header. |

## Releases

For detailed change logs and migration notes, see:

- [v0.9 Release Notes](RELEASE_NOTES_v0.9.md)
