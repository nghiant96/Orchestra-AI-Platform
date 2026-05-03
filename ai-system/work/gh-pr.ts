import { runCommand } from "../utils/api.js";

export interface GhPRCreateResult {
    url: string;
    number: number;
    branch: string;
    base: string;
}

/**
 * Create a GitHub PR using `gh pr create` CLI.
 * Returns structured result or throws on failure.
 */
export async function createGhPR(
    repoRoot: string,
    options: {
        title: string;
        head: string;
        base: string;
        draft?: boolean;
        body?: string;
    }
): Promise<GhPRCreateResult> {
    const args = [
        "pr",
        "create",
        "--title", options.title,
        "--head", options.head,
        "--base", options.base,
        "--json", "url,number,headRefName,baseRefName"
    ];

    if (options.draft) {
        args.push("--draft");
    }

    if (options.body && options.body.length > 0) {
        const bodyFile = `${repoRoot}/.ai-system-pr-body-${Math.random().toString(36).slice(2, 8)}.tmp`;
        try {
            await import("node:fs/promises").then((fs) => fs.writeFile(bodyFile, options.body!, "utf8"));
            args.push("--body-file", bodyFile);
            const { stdout } = await runCommand({
                command: "gh",
                args,
                cwd: repoRoot,
                timeoutMs: 60_000
            });
            const parsed = JSON.parse(stdout.trim());
            return {
                url: parsed.url,
                number: parsed.number,
                branch: parsed.headRefName,
                base: parsed.baseRefName
            };
        } finally {
            try { await import("node:fs/promises").then((fs) => fs.unlink(bodyFile)); } catch { /* best effort */ }
        }
    } else {
        args.push("--body", "");
    }

    const { stdout } = await runCommand({
        command: "gh",
        args,
        cwd: repoRoot,
        timeoutMs: 60_000
    });

    const parsed = JSON.parse(stdout.trim());
    return {
        url: parsed.url,
        number: parsed.number,
        branch: parsed.headRefName,
        base: parsed.baseRefName
    };
}