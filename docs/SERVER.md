# Server & Operations

Orchestra can run as a long-lived service for teams or containerized environments.

## Running the Server

Start the HTTP server:
```bash
pnpm run server
```

Or via Docker:
```bash
docker run --rm -it \
  -e AI_SYSTEM_SERVER_MODE=true \
  -e AI_SYSTEM_SERVER_TOKEN=my-secret \
  -p 3927:3927 \
  -v "$PWD:/workspace" \
  ai-coding-system:local
```

## API Reference

### Synchronous Execution
`POST /run` - Execute a task immediately.

### Job Queue
- `POST /jobs` - Enqueue a background task.
- `GET /jobs` - List recent jobs.
- `GET /jobs/:id` - Get job status and logs.
- `POST /jobs/:id/cancel` - Cancel a running job.

## Dashboard

The dashboard is a web-based UI available when running the server. It provides a real-time view of active tasks, logs, and artifacts.

## Deployment

We recommend deploying Orchestra using the provided `Dockerfile` and `docker-compose.yml`. Ensure you mount your repository and CLI authentication directories as volumes.

See [**Security Policy**](SECURITY.md) for production hardening guidelines.
