# Orchestra Dashboard

The official web interface for the **Orchestra AI Platform**. Monitor, approve, and audit your AI-assisted software development tasks in real-time.

## Features

- **Work Board:** Track active, pending, and completed Work Items.
- **Job Queue:** Monitor the low-level execution of AI agents (Planner, Generator, Reviewer).
- **Live Logs:** Stream real-time execution logs via SSE.
- **Artifact Viewer:** Inspect generated patches, check results, and AI review findings.
- **Control Plane:** Approve or reject AI-generated plans and code changes.
- **Analytics:** View provider performance, cost metrics, and success rates.

## Getting Started

### Development

From the project root:

```bash
pnpm run local:dev
```

This will start the AI System server and the dashboard development server concurrently. The dashboard proxy reads `AI_SYSTEM_SERVER_TOKEN` from the repo-root `.env` file when present.

### Production Build

```bash
pnpm run dashboard:build
```

The static assets will be generated in `dashboard/dist`.

## Tech Stack

- **Framework:** React + TypeScript
- **Bundler:** Vite
- **Styling:** TailwindCSS
- **State Management:** React Hooks + Fetch API
- **Icons:** Lucide React
