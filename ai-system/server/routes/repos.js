import { canPerformAction } from "../../core/permissions.js";
import { RepoRegistryError, RepoRegistryStore } from "../../repos/repo-registry.js";
export const reposRoute = {
    async handle(req, res, url, ctx) {
        if (url.pathname === "/repos" && req.method === "GET") {
            const repos = await new RepoRegistryStore(ctx.defaultCwd).list();
            ctx.respondJson(res, 200, { ok: true, version: 1, repos });
            return true;
        }
        if (url.pathname === "/repos" && req.method === "POST") {
            if (!canPerformAction(ctx.actor, ctx.currentGlobalRules ?? (await ctx.globalRulesPromise).rules, "work_item.create")) {
                ctx.respondJson(res, 403, { ok: false, error: "Operator role required" });
                return true;
            }
            const payload = await readJsonBody(req);
            try {
                const repo = await new RepoRegistryStore(ctx.defaultCwd).register(payload, ctx.allowedRoots);
                await ctx.auditLog.append({
                    actor: ctx.actor,
                    action: "repo.register",
                    cwd: repo.localPath,
                    details: { repoId: repo.repoId, localPath: repo.localPath }
                });
                ctx.respondJson(res, 201, { ok: true, repo });
                return true;
            }
            catch (err) {
                if (err instanceof RepoRegistryError) {
                    ctx.respondJson(res, err.statusCode, { ok: false, error: err.message });
                    return true;
                }
                throw err;
            }
        }
        const repoMatch = /^\/repos\/([^/]+)$/.exec(url.pathname);
        if (repoMatch && req.method === "GET") {
            const repo = await new RepoRegistryStore(ctx.defaultCwd).get(repoMatch[1] ?? "");
            if (!repo) {
                ctx.respondJson(res, 404, { ok: false, error: "Repo not found" });
                return true;
            }
            ctx.respondJson(res, 200, { ok: true, repo });
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
