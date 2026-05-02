import type http from "node:http";
import { loadJsonIfExists, writeJsonFile, resolveProjectConfigPath, mergeConfig } from "../../utils/config.js";
import { canPerformAction } from "../../core/permissions.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";

export const configRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/config" && req.method === "GET") {
      try {
        const { rules, profile, globalProfile, plugins } = await loadRules(ctx.defaultCwd);
        const safeRules = JSON.parse(JSON.stringify(rules));
        if (safeRules.providers) {
          for (const provider of Object.values(safeRules.providers as Record<string, any>)) {
            if (provider.api_key) provider.api_key = "********";
          }
        }
        if (safeRules.memory?.api_key) safeRules.memory.api_key = "********";
        ctx.respondJson(res, 200, { version: 1, rules: safeRules, profile, globalProfile, plugins });
        return true;
      } catch (err) {
        ctx.respondJson(res, 500, { ok: false, error: (err as Error).message });
        return true;
      }
    }

    if (url.pathname === "/config" && req.method === "POST") {
      if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "config.update")) {
        ctx.respondJson(res, 403, { ok: false, error: "Admin role required" });
        return true;
      }
      try {
        const payload = await readJsonBody(req);
        const configPath = await resolveProjectConfigPath(ctx.defaultCwd);
        if (!configPath) {
          ctx.respondJson(res, 404, { ok: false, error: "Project config file not found. Create .ai-system.json first." });
          return true;
        }
        const existing = (await loadJsonIfExists<any>(configPath)) || {};
        const updated = mergeConfig(existing, payload);
        await writeJsonFile(configPath, updated);
        await ctx.auditLog.append({ actor: ctx.actor, action: "config.update", cwd: ctx.defaultCwd, details: { configPath } });
        ctx.respondJson(res, 200, { ok: true, config: updated });
        return true;
      } catch (err) {
        ctx.respondJson(res, 500, { ok: false, error: (err as Error).message });
        return true;
      }
    }

    return false;
  }
};

async function loadRules(cwd: string) {
  const { loadRules } = await import("../../core/orchestrator-runtime.js");
  return loadRules(cwd);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}
