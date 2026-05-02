import type http from "node:http";
import { roleCan } from "../../core/audit-log.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";

export const adminRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/audit" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 100);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", Pragma: "no-cache", Expires: "0" });
      res.end(JSON.stringify({ ok: true, version: 1, events: await ctx.auditLog.list(limit) }, null, 2));
      return true;
    }
    if (url.pathname === "/audit/export" && req.method === "GET") {
      if (!roleCan(ctx.actor, "operator")) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Operator role required" }, null, 2));
        return true;
      }
      const limit = Number(url.searchParams.get("limit") || 1000);
      const format = url.searchParams.get("format") || "json";
      const events = await ctx.auditLog.list(limit);
      if (format === "jsonl") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
        res.end(events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, version: 1, events }, null, 2));
      return true;
    }
    return false;
  }
};
