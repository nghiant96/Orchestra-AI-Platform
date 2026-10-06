/**
 * Token accounting for the worker execution path.
 *
 * The in-process orchestrator has had usage tracking all along, but it wraps
 * `JsonProvider` — the planner/generator/reviewer/fixer seats. The worker path
 * spawns a CLI and reads stdout, so none of that applied and a worker fleet run
 * reported no cost at all. Every question about what the fleet costs was
 * therefore unanswerable.
 *
 * What is recorded here is deliberately split into two kinds of number:
 *
 *   - **Measured**: invocation count, bytes in and out, wall-clock duration.
 *     These are exact.
 *   - **Estimated**: token counts derived from byte length. These are a
 *     four-bytes-per-token approximation, not a tokenizer, and the field names
 *     say so. A CLI that reports its own usage should override them rather than
 *     have this guess presented as truth.
 */

/** Rough bytes-per-token ratio for English text and code. */
const BYTES_PER_TOKEN = 4;

export interface ProviderInvocationUsage {
  /** Which phase or step spawned the provider. */
  label: string;
  command: string;
  startedAt: string;
  durationMs: number;
  promptBytes: number;
  outputBytes: number;
  estimatedPromptTokens: number;
  estimatedOutputTokens: number;
  exitOk: boolean;
}

export interface ProviderUsageReport {
  version: 1;
  jobId: string;
  invocations: ProviderInvocationUsage[];
  totals: {
    invocations: number;
    promptBytes: number;
    outputBytes: number;
    estimatedPromptTokens: number;
    estimatedOutputTokens: number;
    estimatedTotalTokens: number;
    durationMs: number;
  };
  /** Stated so nobody reads the estimates as metered usage. */
  note: string;
}

export function estimateTokens(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / BYTES_PER_TOKEN);
}

/**
 * Collects one job's provider invocations.
 *
 * Recording never throws: a broken meter must not fail a job that otherwise
 * succeeded.
 */
export class ProviderUsageRecorder {
  private readonly invocations: ProviderInvocationUsage[] = [];

  constructor(private readonly jobId: string) {}

  record(input: {
    label: string;
    command: string;
    startedAt: number;
    durationMs: number;
    promptBytes: number;
    outputBytes: number;
    exitOk: boolean;
  }): void {
    this.invocations.push({
      label: input.label,
      command: input.command,
      startedAt: new Date(input.startedAt).toISOString(),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      promptBytes: input.promptBytes,
      outputBytes: input.outputBytes,
      estimatedPromptTokens: estimateTokens(input.promptBytes),
      estimatedOutputTokens: estimateTokens(input.outputBytes),
      exitOk: input.exitOk
    });
  }

  get count(): number {
    return this.invocations.length;
  }

  build(): ProviderUsageReport {
    const totals = this.invocations.reduce(
      (accumulator, invocation) => ({
        invocations: accumulator.invocations + 1,
        promptBytes: accumulator.promptBytes + invocation.promptBytes,
        outputBytes: accumulator.outputBytes + invocation.outputBytes,
        estimatedPromptTokens: accumulator.estimatedPromptTokens + invocation.estimatedPromptTokens,
        estimatedOutputTokens: accumulator.estimatedOutputTokens + invocation.estimatedOutputTokens,
        estimatedTotalTokens:
          accumulator.estimatedTotalTokens + invocation.estimatedPromptTokens + invocation.estimatedOutputTokens,
        durationMs: accumulator.durationMs + invocation.durationMs
      }),
      {
        invocations: 0,
        promptBytes: 0,
        outputBytes: 0,
        estimatedPromptTokens: 0,
        estimatedOutputTokens: 0,
        estimatedTotalTokens: 0,
        durationMs: 0
      }
    );

    return {
      version: 1,
      jobId: this.jobId,
      invocations: this.invocations,
      totals,
      note:
        `Byte counts and durations are measured. Token counts are estimated at ~${BYTES_PER_TOKEN} bytes per token ` +
        "from the prompt and stdout of each provider process; they do not include tokens the provider CLI spent " +
        "reading the repository on its own, so treat them as a floor rather than a bill."
    };
  }
}
