# Operations And API Guide

Last updated: 2026-04-30

This guide covers the local HTTP service and dashboard workflows for operating the AI Coding System after the v0.2-v0.7 roadmap implementation.

## Start The Service

Run the server from the repository root:

```bash
AI_SYSTEM_SERVER_MODE=true \
AI_SYSTEM_SERVER_TOKEN=change-me \
pnpm run server
```

For multi-project operation, set `AI_SYSTEM_ALLOWED_WORKDIRS` to a comma-separated list of absolute repository paths. Requests with `cwd` outside those roots are rejected.

```bash
AI_SYSTEM_ALLOWED_WORKDIRS="/repo/a,/repo/b" pnpm run server
```

Run the dashboard in another shell:

```bash
pnpm run dashboard:dev
```

## Authentication And Roles

All API routes except the health/log preflight paths require the configured bearer token or server auth mechanism used by `isAuthorized`.

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
