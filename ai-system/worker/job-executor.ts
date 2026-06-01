import fs from "node:fs/promises";
import path from "node:path";
import type { QueueJob } from "../core/job-queue.js";
import type { Worker } from "../workers/worker-types.js";
import type { WorkerApiClient } from "./worker-client.js";
import { ensurePathWithinRoot, redactWorkerLogLine } from "./worker-safety.js";

export interface WorkerJobExecutionContext {
  client: WorkerApiClient;
  worker: Worker;
  job: QueueJob;
  workspaceRoots: string[];
  emitLog(message: string): void;
  markFilesystemMutation(stage: string, worktreePath?: string): Promise<void>;
}

export interface WorkerJobExecutionResult {
  ok: boolean;
  summary: string;
  logs: string[];
  filesystemMutated: boolean;
}

interface MutationInstruction {
  relativePath: string;
  content: string;
}

export async function executeWorkerJob(ctx: WorkerJobExecutionContext): Promise<WorkerJobExecutionResult> {
  const logs: string[] = [];
  const emit = (message: string) => {
    const line = redactWorkerLogLine(message);
    logs.push(line);
    ctx.emitLog(line);
  };

  emit(`claimed job ${ctx.job.jobId}`);
  emit(`task: ${redactWorkerLogLine(ctx.job.task)}`);

  const mutation = parseMutationInstruction(ctx.job.task);
  if (mutation) {
    const workspaceRoot = ctx.workspaceRoots[0] ?? ctx.job.cwd;
    const targetPath = ensurePathWithinRoot(workspaceRoot, path.join(workspaceRoot, mutation.relativePath));

    emit(`checkpointing filesystem mutation for ${mutation.relativePath}`);
    await ctx.markFilesystemMutation("apply_patch", workspaceRoot);
    emit(`writing ${mutation.relativePath}`);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, mutation.content, "utf8");
    emit(`wrote ${mutation.relativePath}`);

    return {
      ok: true,
      summary: `Wrote ${mutation.relativePath}`,
      logs,
      filesystemMutated: true
    };
  }

  emit("dummy job completed without filesystem changes");
  return {
    ok: true,
    summary: "No-op worker execution completed.",
    logs,
    filesystemMutated: false
  };
}

function parseMutationInstruction(task: string): MutationInstruction | null {
  const trimmed = task.trim();
  const match = /^worker:write-file\s+(.+?)::([\s\S]*)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const relativePath = match[1]?.trim() || "";
  const content = match[2] ?? "";
  if (!relativePath) {
    return null;
  }

  return { relativePath, content };
}
