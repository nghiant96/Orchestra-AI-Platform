import process from "node:process";
import { createAiSystemServer } from "./server-app.js";
import { loadEnvironment } from "./utils/api.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  await loadEnvironment(process.cwd());

  const port = Number(process.env.PORT || process.env.AI_SYSTEM_PORT || 3927);
  const defaultCwd = process.env.AI_SYSTEM_WORKDIR || process.cwd();
  const authToken = process.env.AI_SYSTEM_SERVER_TOKEN?.trim() || "";

  if (!authToken) {
    const logger = createLogger();
    logger.error("AI_SYSTEM_SERVER_TOKEN is required in server mode.");
    process.exit(1);
  }

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
}

main().catch((error) => {
  const logger = createLogger();
  logger.error(`Failed to start AI system server: ${(error as Error).message}`);
  process.exit(1);
});
