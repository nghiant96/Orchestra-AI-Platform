import type { JobLease, QueueJob } from "../core/job-queue.js";
import type { Worker } from "../workers/worker-types.js";

export interface WorkerClientOptions {
  serverUrl: string;
  token: string;
}

export interface WorkerRegisterInput {
  name: string;
  version?: string;
  os?: string;
  arch?: string;
  labels?: string[];
  workspaceRoots?: string[];
  capabilities?: Worker["capabilities"];
}

export interface WorkerHeartbeatInput {
  status?: string;
  currentJobId?: string;
  leaseId?: string;
  jobId?: string;
  freeDiskGb?: number;
  cpuLoad?: number;
}

export interface WorkerLogUploadInput {
  lines: string[];
  leaseId: string;
}

export class WorkerApiClient {
  constructor(private readonly options: WorkerClientOptions) {}

  async register(input: WorkerRegisterInput): Promise<{ worker: Worker }> {
    return this.requestJson("/workers", {
      method: "POST",
      body: input
    });
  }

  async heartbeat(workerId: string, input: WorkerHeartbeatInput): Promise<{ worker: Worker; leaseRenewed?: boolean; leaseError?: string }> {
    return this.requestJson(`/workers/${encodeURIComponent(workerId)}/heartbeat`, {
      method: "POST",
      body: input
    });
  }

  async start(workerId: string, jobId: string, leaseId: string): Promise<{ ok: boolean; error?: string }> {
    return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/start`, {
      method: "POST",
      body: { workerId, leaseId }
    });
  }

  async claim(workerId: string): Promise<{ ok: boolean; job: QueueJob | null; lease: JobLease | null; retryAfterMs?: number; rejectionReason?: string }> {
    return this.requestJson(`/workers/${encodeURIComponent(workerId)}/jobs/claim`, {
      method: "POST",
      body: {}
    });
  }

  async complete(workerId: string, jobId: string, leaseId: string, result?: Partial<QueueJob>): Promise<{ ok: boolean; error?: string }> {
    return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST",
      body: { workerId, leaseId, ...result }
    });
  }

  async fail(workerId: string, jobId: string, leaseId: string, message: string, result?: Partial<QueueJob>): Promise<{ ok: boolean; error?: string }> {
    return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/fail`, {
      method: "POST",
      body: { workerId, leaseId, message, ...result }
    });
  }

  async checkpoint(
    workerId: string,
    jobId: string,
    leaseId: string,
    checkpoint: { stage: string; filesystemMutated: boolean; worktreePath?: string }
  ): Promise<{ ok: boolean; error?: string }> {
    return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/checkpoint`, {
      method: "POST",
      body: { workerId, leaseId, ...checkpoint }
    });
  }

  async uploadLogs(workerId: string, jobId: string, leaseId: string, lines: string[]): Promise<{ ok: boolean; error?: string }> {
    return this.requestJson(`/workers/${encodeURIComponent(workerId)}/jobs/${encodeURIComponent(jobId)}/logs`, {
      method: "POST",
      body: { leaseId, lines }
    });
  }

  private async requestJson(pathname: string, options: { method?: string; body?: unknown }): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.token}`,
      Accept: "application/json"
    };

    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }

    const response = await fetch(`${this.options.serverUrl}${pathname}`, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(15000)
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      const excerpt = text.length > 500 ? `${text.slice(0, 500)}...` : text;
      throw new Error(`Invalid JSON response from ${pathname}: ${(error as Error).message}; body=${excerpt}`, { cause: error });
    }
    if (!response.ok) {
      const errorBody = parsed && typeof parsed === "object" ? parsed as { error?: unknown; leaseError?: unknown } : {};
      const message = typeof errorBody.error === "string"
        ? errorBody.error
        : typeof errorBody.leaseError === "string"
          ? errorBody.leaseError
          : `HTTP ${response.status} for ${pathname}`;
      throw new Error(message);
    }
    return parsed;
  }
}
