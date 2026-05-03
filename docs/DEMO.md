# Demo Walkthrough

> A 5-minute tour of Orchestra AI Platform that proves the system works end-to-end.

## Prerequisites

- Node.js 20+, pnpm 8+
- At least one AI CLI installed (`gemini`, `codex`, or `claude`)
- This repo cloned and `pnpm install` completed

## 1. Start the Full Stack

```bash
# One command — server + dashboard
pnpm run local:dev
```

Verify:
- Server health: `curl http://localhost:3927/health`
- Dashboard: open `http://localhost:5253`

If the server asks for a token, add to `.env` and restart:
```
AI_SYSTEM_SERVER_TOKEN=demo-token
```

## 2. Run a Low-Risk Bugfix (Dry Run)

From another terminal (or the dashboard "New Job" form):

```bash
pnpm ai "Add a missing null check in the health route response" --dry-run
```

What happens:
1. **Plan** — The planner inspects the codebase, identifies the file to fix
2. **Generate** — A generator writes the fix
3. **Verify** — Lint + typecheck run against the change
4. **Review** — Another AI reviews the diff

Expected output includes the stage transitions, tool check results, and a review verdict.

## 3. View Results in the Dashboard

1. Open `http://localhost:5253`
2. Click the **Jobs** panel — you'll see the completed run
3. Click the job row to open **Job Detail**:
   - **Timeline** tab: see each stage and its duration
   - **Artifacts** tab: see generated files with before/after diffs
   - **Review** tab: see the AI reviewer's findings

## 4. Check Artifacts on Disk

Every run persists evidence under `.ai-system-artifacts/`:

```bash
ls .ai-system-artifacts/runs/
```

The latest run directory contains:
- `plan.json` — file targets, risk assessment, provider selections
- `iterations/` — each generation cycle with original + generated files
- `review.json` — the AI reviewer's structured verdict
- `summary.json` — stage timings, token usage, cost estimate

## 5. Try the Workspace Engine (Preview)

```bash
# Create a work item for a comment cleanup task
pnpm ai work create "Clean up stale TODO comments in the codebase"

# List work items
pnpm ai work list

# Assess the work item
pnpm ai work assess <id>

# Execute the first node
pnpm ai work run <id>
```

## What This Proves

| Criterion | Evidence |
|---|---|
| System starts clean | Step 1 — one command, server + dashboard up |
| Docs match behavior | Ports, token, auth all consistent |
| Dry-run is safe | Step 2 — no files written, artifacts captured |
| Dashboard shows state | Step 3 — real-time job view + detail modal |
| Artifacts are traceable | Step 4 — disk evidence for every stage |
| Workspace engine works | Step 5 — work item create → assess → run |

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the full design
- Read [SERVER.md](SERVER.md) for API reference
- Read [WORKSPACE.md](WORKSPACE.md) for workspace engine details