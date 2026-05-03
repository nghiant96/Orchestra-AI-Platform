# Server & Dashboard Guide

Orchestra can run as a **long-lived HTTP service** for teams, CI environments, or containerized deployments. It provides a job queue, real-time dashboard, audit logging, and a comprehensive REST API.

---

## Quick Start

### Local Development

```bash
# Start server + dashboard simultaneously
pnpm run local:dev

# Or separately:
pnpm run server          # API server on :3927
pnpm run dashboard:dev   # Dashboard on :5253
```

`pnpm run server` loads a repo-root `.env` file automatically before reading server settings.

### Docker

```bash
# Start with Docker Compose
pnpm run docker:up

# Or manually:
docker run --rm -it \
  -e AI_SYSTEM_SERVER_MODE=true \
  -e AI_SYSTEM_SERVER_TOKEN=my-secret \
  -p 3927:3927 \
  -v "$PWD:/workspace" \
  ai-coding-system:local
```

### Environment Configuration

| Variable | Description | Default |
|---|---|---|
| `AI_SYSTEM_SERVER_MODE` | Enable server mode | `false` |
| `AI_SYSTEM_SERVER_TOKEN` | Bearer token for API auth | None (required in server mode) |
| `PORT` or `AI_SYSTEM_PORT` | HTTP port | `3927` |
| `AI_SYSTEM_ALLOWED_WORKDIRS` | Comma-separated allowed directories | CWD only |

---

## API Reference

All endpoints return JSON. Authenticated requests require `Authorization: Bearer <token>` header.

### Health

```
GET /health
```
Returns server status, version, queue state, and uptime.

### Jobs

```
POST /jobs                    → 202 Accepted
```
Enqueue a background task. Body: `{ task, dryRun?, cwd?, workflowMode? }`

Accepts a GitHub URL as `task` to auto-detect issue/PR context:
```json
{ "task": "https://github.com/org/repo/issues/123" }
```

```
GET  /jobs                    → 200 OK       List recent jobs
GET  /jobs/:id                → 200 OK       Get job detail + result
POST /jobs/:id/cancel         → 200 OK       Cancel queued/running job
POST /jobs/:id/approve        → 200 OK       Approve paused job
GET  /jobs/:id/stream         → SSE stream   Real-time log events
```

### Work Items

```
GET  /work-items              → 200 OK       List all work items
POST /work-items              → 201 Created  Create work item
GET  /work-items/:id          → 200 OK       Get work item detail
POST /work-items/:id/assess   → 200 OK       Run risk assessment
POST /work-items/:id/run      → 200 OK       Execute next graph node
POST /work-items/:id/cancel   → 200 OK       Cancel execution
POST /work-items/:id/handoff  → 200 OK       Create PR and hand off
```

### Configuration

```
GET  /config                  → 200 OK       Get effective config
POST /config                  → 200 OK       Update runtime config
```

### Workspaces

```
POST /workspaces              → 201 Created  Register an additional allowed workspace root
```

The dashboard uses this endpoint to persist extra workspace roots in `.ai-system-server/workspaces.json`.

### Administration

```
GET  /health                  → 200 OK       Server health + queue stats
GET  /stats                   → 200 OK       Analytics dashboard data
GET  /audit                   → 200 OK       Audit log events
GET  /audit/export            → 200 OK       Export audit as JSON/CSV
POST /queue/pause             → 200 OK       Pause job processing
POST /queue/resume            → 200 OK       Resume job processing
POST /queue/clear-finished    → 200 OK       Remove completed jobs
GET  /lessons                 → 200 OK       List lessons learned
POST /lessons                 → 201 Created  Add a lesson
```

### SSE Log Streaming

```
GET /jobs/:id/stream
```

Returns a Server-Sent Events stream of job log messages:

```
data: {"level":"info","message":"Planning...","timestamp":"..."}
data: {"level":"info","message":"Generating code...","timestamp":"..."}
data: {"level":"success","message":"All checks passed","timestamp":"..."}
```

---

## Dashboard

The web dashboard (React + Vite) is available at `http://localhost:5253` when running `dashboard:dev`.

### Panels

| Panel | Description |
|---|---|
| **Jobs** | Live list of jobs with status pills, duration, provider info. Click to open detail. |
| **Work Board** | Kanban-style view of work items grouped by status. Shows progress bars, branch names, PR links. |
| **Inbox** | Import GitHub issues/PRs by URL. Auto-detects issue vs PR and creates work items with dedup. |
| **Analytics** | Charts for cost per day, failure classification breakdown, provider performance comparison, queue latency. |
| **Config** | Live config editor with risk policy visualization and approval mode toggle. |

### Job Detail Modal

Shows the full execution history:
- Execution timeline with stage durations
- Iteration diffs (before/after per file)
- Tool check results (lint errors, test failures)
- Review comments from AI reviewer
- Provider metrics (tokens, cost, model used)

### Work Item Detail Modal

7-tab view for complete work item visibility:

| Tab | Content |
|---|---|
| **Assessment** | Risk level, complexity, tier, estimated effort |
| **Task Graph** | Visual DAG of execution nodes with status |
| **Checklist** | Evidence-based checklist with run/commit proof |
| **Runs** | Linked orchestrator runs with results |
| **Branch/PR** | Branch name, commit history, PR URL |
| **CI Checks** | Real-time CI status from `gh pr checks` |
| **Actions** | Assess, Run, Cancel, Retry, Handoff buttons |

---

## RBAC & Audit

### Roles

| Role | Permissions |
|---|---|
| **viewer** | Read jobs, work items, config, audit |
| **operator** | All viewer + create/cancel jobs, pause/resume queue, manage work items |
| **admin** | All operator + update config, clear queue, manage lessons |

### Audit Log

Every mutation is recorded:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "action": "job.create",
  "actor": { "id": "operator-1", "role": "operator" },
  "details": { "jobId": "j-123", "task": "Add retry logic" }
}
```

Export via `GET /audit/export?format=json` or `?format=csv`.

---

## Deployment

See the [**Operator Runbook**](OPERATIONS.md) for production deployment guidance, including:
- Docker Compose configuration
- Volume mounts for repo and CLI credentials
- Health check configuration
- Log rotation and artifact retention
- Monitoring and alerting
