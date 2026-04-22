import http from "node:http";
import process from "node:process";
import { Orchestrator } from "./core/orchestrator.js";
import { createLogger } from "./utils/logger.js";

const port = Number(process.env.PORT || process.env.AI_SYSTEM_PORT || 3927);
const defaultCwd = process.env.AI_SYSTEM_WORKDIR || "/workspace";
const authToken = process.env.AI_SYSTEM_SERVER_TOKEN || "";
const logger = createLogger();

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      return respondJson(res, 200, {
        ok: true,
        mode: "server",
        cwd: defaultCwd
      });
    }

    if (req.url === "/run" && req.method === "POST") {
      if (!isAuthorized(req, authToken)) {
        return respondJson(res, 401, {
          ok: false,
          error: "Unauthorized"
        });
      }

      const payload = await readJsonBody(req);
      if (!payload?.task || typeof payload.task !== "string") {
        return respondJson(res, 400, {
          ok: false,
          error: "Missing task"
        });
      }

      const orchestrator = new Orchestrator({
        repoRoot: typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : defaultCwd,
        logger
      });

      const result = await orchestrator.run(payload.task, {
        dryRun: payload.dryRun !== false
      });

      return respondJson(res, result.ok ? 200 : 422, result);
    }

    return respondJson(res, 404, {
      ok: false,
      error: "Not found"
    });
  } catch (error) {
    const normalized = error as Error;
    return respondJson(res, 500, {
      ok: false,
      error: normalized.message
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  logger.info(`AI system server listening on port ${port} with cwd ${defaultCwd}`);
});

server.on("error", (error) => {
  logger.error(`AI system server failed to start on port ${port}: ${error.message}`);
  process.exit(1);
});

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  if (!token) {
    return true;
  }

  const header = req.headers.authorization || req.headers["x-api-key"];
  return header === `Bearer ${token}` || header === token;
}

function respondJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
