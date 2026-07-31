import type http from "node:http";
import { canPerformAction } from "../../core/permissions.js";
import {
  listWorkItems,
  createWorkItem,
  getWorkItem,
  getWorkItemEvents,
  getWorkItemLesson,
  assessWorkItem,
  runWorkItem,
  handoffWorkItem,
  cancelOrRetryWorkItem
} from "../../work/work-item-service.js";
import { RepoRegistryError, resolveRegisteredRepoPath } from "../../repos/repo-registry.js";
import type { RouteHandler, ServerRouteContext } from "../routes-context.js";
import { readJsonBody } from "../read-json-body.js";

export const workItemsRoute: RouteHandler = {
  async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: ServerRouteContext): Promise<boolean> {
    if (url.pathname === "/work-items" && req.method === "GET") {
      const cwd = await resolveWorkItemRouteCwd(ctx, url.searchParams.get("cwd"), url.searchParams.get("repoId"));
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
      const repo = await resolveRepoOrRespond(ctx, res, payload);
      if (repo === false) return true;
      const cwd = await ctx.resolveRequestedCwd(payload?.cwd ?? repo?.localPath, ctx.defaultCwd, ctx.allowedRoots);
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
      const result = await createWorkItem(serviceCtx, cwd, repo
        ? {
            ...payload,
            repo: {
              ...(typeof payload.repo === "object" && payload.repo !== null ? payload.repo : {}),
              repoId: repo.repoId,
              localPath: repo.localPath,
              remote: repo.remote
            }
          }
        : payload);
      ctx.respondJson(res, 201, result);
      return true;
    }

    const workItemMatch = /^\/work-items\/([^/]+)(?:\/(assess|run|cancel|retry|handoff))?$/.exec(url.pathname);
    if (workItemMatch && req.method === "GET" && !workItemMatch[2]) {
      const workItemId = workItemMatch[1] ?? "";
      const cwd = await resolveWorkItemRouteCwd(ctx, url.searchParams.get("cwd"), url.searchParams.get("repoId"));
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
      const cwd = await resolveWorkItemRouteCwd(ctx, url.searchParams.get("cwd"), url.searchParams.get("repoId"));
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

    const lessonMatch = /^\/work-items\/([^/]+)\/lesson$/.exec(url.pathname);
    if (lessonMatch && req.method === "GET") {
      const workItemId = lessonMatch[1] ?? "";
      const cwd = await resolveWorkItemRouteCwd(ctx, url.searchParams.get("cwd"), url.searchParams.get("repoId"));
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
      const result = await getWorkItemLesson(serviceCtx, cwd, workItemId);
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
      const repo = await resolveRepoOrRespond(ctx, res, payload, url.searchParams.get("repoId"));
      if (repo === false) return true;
      const cwd = await ctx.resolveRequestedCwd(payload?.cwd ?? repo?.localPath ?? url.searchParams.get("cwd"), ctx.defaultCwd, ctx.allowedRoots);
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
      const result = await cancelOrRetryWorkItem(serviceCtx, cwd, workItemId, action as "cancel" | "retry");
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

async function resolveWorkItemRouteCwd(
  ctx: ServerRouteContext,
  cwd: unknown,
  repoId: unknown
): Promise<string | null> {
  try {
    const repo = await resolveRepoFromPayload(ctx, { repoId }, undefined);
    return ctx.resolveOptionalRequestedCwd(cwd ?? repo?.localPath, ctx.defaultCwd, ctx.allowedRoots);
  } catch (err) {
    if (err instanceof RepoRegistryError) return null;
    throw err;
  }
}

async function resolveRepoFromPayload(
  ctx: ServerRouteContext,
  payload: Record<string, unknown>,
  fallbackRepoId?: unknown
) {
  const repoId =
    typeof payload.repoId === "string"
      ? payload.repoId
      : typeof fallbackRepoId === "string"
        ? fallbackRepoId
        : typeof payload.repo === "object" && payload.repo !== null && typeof (payload.repo as any).repoId === "string"
          ? (payload.repo as any).repoId
          : undefined;
  if (!repoId) {
    return null;
  }
  const repo = await resolveRegisteredRepoPath(ctx.defaultCwd, repoId, ctx.allowedRoots);
  if (!repo) {
    throw new RepoRegistryError("Repo not found", 404);
  }
  return repo;
}

async function resolveRepoOrRespond(
  ctx: ServerRouteContext,
  res: http.ServerResponse,
  payload: Record<string, unknown>,
  fallbackRepoId?: unknown
) {
  try {
    return await resolveRepoFromPayload(ctx, payload, fallbackRepoId);
  } catch (err) {
    if (err instanceof RepoRegistryError) {
      ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
      return false as const;
    }
    throw err;
  }
}
