import type { GeneratedFile, Logger, ReviewIssue, RulesConfig } from "../types.js";
import { runToolChecks } from "../core/tool-executor.js";

export async function runStaticAnalysis(
  repoRoot: string,
  changedFiles: GeneratedFile[],
  logger?: Logger,
  rules?: RulesConfig
): Promise<ReviewIssue[]> {
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
        planner: { type: "gemini-cli" },
        reviewer: { type: "gemini-cli" },
        generator: { type: "codex-cli" },
        fixer: { type: "codex-cli" }
      }
    },
    logger
  });

  return summary.issues;
}
