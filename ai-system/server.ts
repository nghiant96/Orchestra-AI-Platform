import process from "node:process";
import { createAiSystemServer } from "./server-app.js";
import { loadEnvironment } from "./utils/api.js";
import { createLogger } from "./utils/logger.js";
import { resolveServerAuthToken } from "./server-startup.js";

async function main(): Promise<void> {
  await loadEnvironment(process.cwd());

  const port = Number(process.env.PORT || process.env.AI_SYSTEM_PORT || 3927);
  const defaultCwd = process.env.AI_SYSTEM_WORKDIR || process.cwd();
  const authToken = resolveServerAuthToken(process.env.AI_SYSTEM_SERVER_TOKEN);

  const allowedWorkdirs = (process.env.AI_SYSTEM_ALLOWED_WORKDIRS || defaultCwd)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const queueConcurrency = Number(process.env.AI_SYSTEM_QUEUE_CONCURRENCY || 1);
  const logger = createLogger();

  const server = createAiSystemServer({
    defaultCwd,
    authToken,
    allowedWorkdirs,
    queueConcurrency,
    logger
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info(`AI system server listening on port ${port} with cwd ${defaultCwd}`);
  });

  server.on("error", (error) => {
    logger.error(`AI system server failed to start on port ${port}: ${error.message}`);
    process.exit(1);
  });

  installShutdownHandlers(server, logger);
}

/**
 * Drain the queue before the process goes away.
 *
 * `server.close()` is wired to stop the job queue and close the store, but a
 * container runtime only ever sends a signal — without these handlers Node's
 * default terminates immediately, abandoning running jobs mid-write and leaving
 * store connections open. The forced exit is the backstop: a job that refuses
 * to settle must not be able to block the shutdown forever.
 */
function installShutdownHandlers(
  server: ReturnType<typeof createAiSystemServer>,
  logger: ReturnType<typeof createLogger>
): void {
  const graceMs = Number(process.env.AI_SYSTEM_SHUTDOWN_GRACE_MS) || 30_000;
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      logger.warn(`Received ${signal} during shutdown; exiting now.`);
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, draining before shutdown (grace ${graceMs}ms)...`);

    const forceExit = setTimeout(() => {
      logger.error(`Shutdown exceeded ${graceMs}ms grace period; exiting with work still in flight.`);
      process.exit(1);
    }, graceMs);
    forceExit.unref();

    server.close((error) => {
      clearTimeout(forceExit);
      if (error) {
        logger.error(`Shutdown failed: ${error.message}`);
        process.exit(1);
      }
      logger.info("Shutdown complete.");
      process.exit(0);
    });
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error) => {
  const logger = createLogger();
  logger.error(`Failed to start AI system server: ${(error as Error).message}`);
  process.exit(1);
});
