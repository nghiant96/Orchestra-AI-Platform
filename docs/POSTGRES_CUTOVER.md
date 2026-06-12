# Postgres Cutover Runbook

Use this when moving a release from SQLite/file state to the Postgres-backed HA path.

## Before You Start

- Confirm the target Postgres database exists and is reachable.
- Confirm `AI_SYSTEM_SERVER_TOKEN` is set.
- Keep the old workspace state mounted until validation is complete.

## 10-Minute Cutover

```bash
export AI_SYSTEM_SERVER_TOKEN=replace-me
export ORCHESTRA_STORE=postgres
export ORCHESTRA_POSTGRES_URL=postgresql://orchestra:orchestra@localhost:5432/orchestra
docker compose --profile postgres up -d postgres orchestra-ai-platform
pnpm run postgres:migrate
```

## Verify

1. Call `GET /health`.
2. Confirm the response reports `store.mode=postgres`.
3. Create a small test job and confirm it appears in `GET /jobs?cwd=...`.
4. Confirm `GET /audit?limit=5` returns recent events.
5. Register or heartbeat one worker and confirm it survives a server restart.

## Rollback

- If verification fails, stop the Postgres-backed server.
- Restore the previous `ORCHESTRA_STORE` setting.
- Bring the old workspace-backed deployment back online.
- Keep the Postgres data volume for investigation until the issue is resolved.

## Notes

- `pnpm run postgres:migrate` is safe to rerun during a controlled cutover.
- Treat the old workspace state as the rollback source until the new backend is validated.
- For long-lived production deployments, back up the Postgres volume or managed database before the cutover.
