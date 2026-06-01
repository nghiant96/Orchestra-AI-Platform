import { runToolChecks } from "../core/tool-executor.js";
export async function runStaticAnalysis(repoRoot, changedFiles, logger, rules) {
    const summary = await runToolChecks({
        repoRoot,
        changedFiles,
        rules: rules ?? {
            max_iterations: 3,
            max_files: 5,
            max_context_bytes: 60000,
            request_timeout_ms: 60000,
            request_retries: 3,
            retry_base_delay_ms: 500,
            memory: { enabled: false, backend: "local-file" },
            providers: {
                planner: { type: "agy-cli" },
                reviewer: { type: "agy-cli" },
                generator: { type: "codex-cli" },
                fixer: { type: "codex-cli" }
            }
        },
        logger
    });
    return summary.issues;
}
