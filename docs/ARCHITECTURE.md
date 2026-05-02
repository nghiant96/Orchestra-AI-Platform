# Architecture

## System Overview

Orchestra operates as a role-based orchestration engine. It does not generate code itself; instead, it coordinates a fleet of specialized AI "workers" (CLIs) to complete complex software engineering tasks.

## Core Components

### 1. Orchestrator
The central state machine that manages the task lifecycle:
`Plan -> Context -> Generate -> Check -> Review -> Fix -> Write`

### 2. Agents
- **Planner:** Identifies relevant files and creates an execution strategy.
- **Generator:** Produces code patches based on the plan and context.
- **Reviewer:** Analyzes generated code for bugs, style issues, and security risks.
- **Fixer:** Specialized generator that focuses on repairing failed checks or review issues.

### 3. Context Intelligence
- **Dependency Graph:** Analyzes imports to include related files in the AI's context.
- **Vector Index:** Local semantic search over your codebase using `@xenova/transformers`.
- **Ranked Selection:** Automatically selects the most relevant code chunks to fit within model token limits.

### 4. Tool Executor
A sandboxed environment for running project-specific commands (`lint`, `test`, `build`). Supports `inherit`, `clean-env`, and `docker` modes.

### 5. Artifact Store
Durable storage for every execution step.
- `run-state.json`: The complete state of an orchestrator run.
- `artifact-index.json`: A searchable index of all local runs.
- `timeline.jsonl`: Audit trail of execution events.

## Workflow

1.  **Ingestion:** A task is received via CLI or HTTP API.
2.  **Planning:** The Planner Agent maps the task to specific files.
3.  **Context Expansion:** The system pulls in dependencies and semantic matches.
4.  **Generation:** The Generator Agent produces proposed changes.
5.  **Validation:** Project scripts are run. If they fail, the Fixer Agent is invoked.
6.  **Approval:** Changes are presented for human review (optional).
7.  **Finalization:** Files are written to disk or pushed to a branch.
