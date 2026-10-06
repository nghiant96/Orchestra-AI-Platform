import { createApprovalArtifactBinding, type ApprovalArtifactBinding } from "./approval-proof.js";

export interface PendingApproval {
  resolve: (value: boolean) => void;
  type: "plan" | "checkpoint";
  data?: unknown;
  binding?: ApprovalArtifactBinding;
}

/**
 * Park an in-process run until someone approves or rejects it through the API.
 *
 * Cancelling the job ends the wait as a rejection. Nothing approves a
 * cancelled job, so without this the run waited forever — holding its
 * workspace slot and, at the default concurrency of 1, the entire queue.
 */
export function waitForApproval(options: {
  jobId: string;
  type: "plan" | "checkpoint";
  data: unknown;
  pendingApprovals: Map<string, PendingApproval>;
  signal?: AbortSignal;
  /** Record the wait on the job, given the binding the approval must match. */
  onWaiting?: (binding: ApprovalArtifactBinding) => void;
}): Promise<boolean> {
  const { jobId, type, data, pendingApprovals, signal } = options;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const binding = createApprovalArtifactBinding(data, type);
    const onAbort = () => {
      pendingApprovals.delete(jobId);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingApprovals.set(jobId, {
      resolve: (approved) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(approved);
      },
      type,
      data,
      binding
    });
    options.onWaiting?.(binding);
  });
}
