import { runCommand } from "../utils/api.js";

export interface WorkerProcessSupervisorRunInput {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface WorkerProcessSupervisorRunResult {
  stdout: string;
  stderr: string;
}

export class WorkerProcessSupervisor {
  async run(input: WorkerProcessSupervisorRunInput): Promise<WorkerProcessSupervisorRunResult> {
    const result = await runCommand({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
      timeoutMs: input.timeoutMs,
      signal: input.signal
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}
