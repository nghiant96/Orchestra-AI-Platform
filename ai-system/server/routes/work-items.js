import { canPerformAction } from "../../core/permissions.js";
import { listWorkItems, createWorkItem, getWorkItem, getWorkItemEvents, assessWorkItem, runWorkItem, handoffWorkItem, cancelOrRetryWorkItem } from "../../work/work-item-service.js";
export const workItemsRoute = {
    async handle(req, res, url, ctx) {
        if (url.pathname === "/work-items" && req.method === "GET") {
            const cwd = await ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
            if (!cwd) {
                ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
                return true;
            }
            const serviceCtx = {
                actor: ctx.actor,
                auditLog: ctx.auditLog,
                rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules,
                queue: ctx.queue
            };
            const result = await listWorkItems(serviceCtx, cwd);
            ctx.respondJson(res, 200, result);
            return true;
        }
        if (url.pathname === "/work-items" && req.method === "POST") {
            if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "work_item.create")) {
                ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
                return true;
            }
            const payload = await readJsonBody(req);
            const cwd = await ctx.resolveRequestedCwd(payload?.cwd, ctx.defaultCwd, ctx.allowedRoots);
            if (!cwd) {
                ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
                return true;
            }
            if (typeof payload?.title !== "string" || !payload.title.trim()) {
                ctx.respondJson(res, 400, { ok: false, error: "Missing work item title" });
                return true;
            }
            const serviceCtx = {
                actor: ctx.actor,
                auditLog: ctx.auditLog,
                rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules,
                queue: ctx.queue
            };
            const result = await createWorkItem(serviceCtx, cwd, payload);
            ctx.respondJson(res, 201, result);
            return true;
        }
        const workItemMatch = /^\/work-items\/([^/]+)(?:\/(assess|run|cancel|retry|handoff))?$/.exec(url.pathname);
        if (workItemMatch && req.method === "GET" && !workItemMatch[2]) {
            const workItemId = workItemMatch[1] ?? "";
            const cwd = await ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
            if (!cwd) {
                ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
                return true;
            }
            const serviceCtx = {
                actor: ctx.actor,
                auditLog: ctx.auditLog,
                rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules,
                queue: ctx.queue
            };
            const result = await getWorkItem(serviceCtx, cwd, workItemId);
            if (!result.ok) {
                ctx.respondJson(res, 404, result);
                return true;
            }
            ctx.respondJson(res, 200, result);
            return true;
        }
        const eventsMatch = /^\/work-items\/([^/]+)\/events$/.exec(url.pathname);
        if (eventsMatch && req.method === "GET") {
            const workItemId = eventsMatch[1] ?? "";
            const cwd = await ctx.resolveOptionalRequestedCwd(url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
            if (!cwd) {
                ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
                return true;
            }
            const serviceCtx = {
                actor: ctx.actor,
                auditLog: ctx.auditLog,
                rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules,
                queue: ctx.queue
            };
            const result = await getWorkItemEvents(serviceCtx, cwd, workItemId);
            if (!result.ok) {
                ctx.respondJson(res, 404, result);
                return true;
            }
            ctx.respondJson(res, 200, result);
            return true;
        }
        if (workItemMatch && req.method === "POST" && workItemMatch[2]) {
            if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, `work_item.${workItemMatch[2]}`)) {
                ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
                return true;
            }
            const workItemId = workItemMatch[1] ?? "";
            const action = workItemMatch[2];
            const payload = await readJsonBody(req);
            const cwd = await ctx.resolveRequestedCwd(payload?.cwd ?? url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
            if (!cwd) {
                ctx.respondJson(res, 403, { ok: false, error: "Requested cwd is outside AI_SYSTEM_ALLOWED_WORKDIRS" });
                return true;
            }
            const serviceCtx = {
                actor: ctx.actor,
                auditLog: ctx.auditLog,
                rules: ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules,
                queue: ctx.queue
            };
            if (action === "assess") {
                const result = await assessWorkItem(serviceCtx, cwd, workItemId);
                if (!result.ok) {
                    ctx.respondJson(res, 404, result);
                    return true;
                }
                ctx.respondJson(res, 200, result);
                return true;
            }
            if (action === "run") {
                const result = await runWorkItem(serviceCtx, cwd, workItemId, {
                    dryRun: payload?.dryRun !== false,
                    nodeId: typeof payload?.nodeId === "string" ? payload.nodeId : undefined
                });
                if (!result.ok) {
                    ctx.respondJson(res, result.statusCode ?? 409, result);
                    return true;
                }
                ctx.respondJson(res, 202, result);
                return true;
            }
            if (action === "handoff") {
                const result = await handoffWorkItem(serviceCtx, cwd, workItemId, {
                    draft: payload?.draft !== false,
                    base: typeof payload?.base === "string" ? payload.base : undefined
                });
                if (!result.ok) {
                    ctx.respondJson(res, 404, result);
                    return true;
                }
                ctx.respondJson(res, 200, result);
                return true;
            }
            const result = await cancelOrRetryWorkItem(serviceCtx, cwd, workItemId, action);
            if (!result.ok) {
                ctx.respondJson(res, 404, result);
                return true;
            }
            ctx.respondJson(res, 200, result);
            return true;
        }
        return false;
    }
};
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
