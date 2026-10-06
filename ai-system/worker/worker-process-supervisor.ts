import { runCommand } from "../utils/api.js";
import type { ProviderUsageRecorder } from "./provider-usage.js";

export interface WorkerProcessSupervisorRunInput {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Names this invocation in the usage report; omit for calls not worth metering. */
  usageLabel?: string;
}

export interface WorkerProcessSupervisorRunResult {
  stdout: string;
  stderr: string;
}

export class WorkerProcessSupervisor {
  /**
   * Every provider process goes through here, which makes it the one place
   * worth metering. Attach a recorder and each spawn is accounted for —
   * including the ones that fail, because a failed attempt still costs.
   */
  constructor(private readonly usage?: ProviderUsageRecorder) {}

  async run(input: WorkerProcessSupervisorRunInput): Promise<WorkerProcessSupervisorRunResult> {
    const startedAt = Date.now();
    const promptBytes = Buffer.byteLength(input.args.join(" "), "utf8");

    try {
      const result = await runCommand({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        env: input.env,
        timeoutMs: input.timeoutMs,
        signal: input.signal
      });

      this.meter(input, startedAt, promptBytes, Buffer.byteLength(result.stdout ?? "", "utf8"), true);

      return {
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (error) {
      this.meter(input, startedAt, promptBytes, 0, false);
      throw error;
    }
  }

  private meter(
    input: WorkerProcessSupervisorRunInput,
    startedAt: number,
    promptBytes: number,
    outputBytes: number,
    exitOk: boolean
  ): void {
    if (!this.usage || !input.usageLabel) {
      return;
    }
    try {
      this.usage.record({
        label: input.usageLabel,
        command: input.command,
        startedAt,
        durationMs: Date.now() - startedAt,
        promptBytes,
        outputBytes,
        exitOk
      });
    } catch {
      // A broken meter must never fail the job it is measuring.
    }
  }
}
