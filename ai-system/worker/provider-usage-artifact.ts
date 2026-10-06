import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_PATHS } from "../artifacts/artifact-paths.js";
import type { ProviderUsageRecorder, ProviderUsageReport } from "./provider-usage.js";

/**
 * Write the job's usage report next to its other artifacts.
 *
 * Returns the report so the caller can log a one-line total; returns null when
 * nothing was metered. Failing to write telemetry must never fail the job, so
 * errors here are swallowed deliberately.
 */
export async function persistProviderUsage(
  artifactDir: string,
  usage: ProviderUsageRecorder
): Promise<ProviderUsageReport | null> {
  if (usage.count === 0) {
    return null;
  }
  const report = usage.build();
  try {
    const target = path.join(artifactDir, ARTIFACT_PATHS.providerUsage);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch {
    // Telemetry is not worth failing a completed job over.
  }
  return report;
}

/** One-line summary for the worker log. */
export function summarizeProviderUsage(report: ProviderUsageReport): string {
  const { totals } = report;
  return (
    `provider usage: ${totals.invocations} invocation(s), ` +
    `~${totals.estimatedTotalTokens} est. tokens ` +
    `(${totals.estimatedPromptTokens} in / ${totals.estimatedOutputTokens} out), ` +
    `${Math.round(totals.durationMs / 1000)}s provider time`
  );
}
