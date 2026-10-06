import type http from "node:http";
import { loadJsonIfExists, writeJsonFile, resolveProjectConfigPath, mergeConfig } from "../../utils/config.js";
import { canPerformAction } from "../../core/permissions.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";
import { readJsonBody } from "../read-json-body.js";
import { maskSecretFields, restoreMaskedSecrets } from "../../security/secret-redaction.js";

export const configRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/config" && req.method === "GET") {
      try {
        const { rules, profile, globalProfile, plugins } = await loadRules(ctx.defaultCwd);
        // Mask every secret-named field, not a hand-kept list: the list covered
        // provider and memory API keys but sent webhook signing secrets in clear.
        const safeRules = maskSecretFields(rules);
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
        const updated = mergeConfig(existing, restoreMaskedSecrets(payload, existing));
        await writeJsonFile(configPath, updated);
        await ctx.auditLog.append({ actor: ctx.actor, action: "config.update", cwd: ctx.defaultCwd, details: { configPath } });
        ctx.respondJson(res, 200, { ok: true, config: maskSecretFields(updated) });
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
