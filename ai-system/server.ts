import process from "node:process";
import { createAiSystemServer } from "./server-app.js";
import { createLogger } from "./utils/logger.js";

const port = Number(process.env.PORT || process.env.AI_SYSTEM_PORT || 3927);
const defaultCwd = process.env.AI_SYSTEM_WORKDIR || process.cwd();
const authToken = process.env.AI_SYSTEM_SERVER_TOKEN || "";
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
