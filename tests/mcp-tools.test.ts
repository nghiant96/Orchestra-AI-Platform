import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileBackedJobQueue, resolveJobQueueDirectory } from "../ai-system/core/job-queue.js";
import { FileAuditLog, resolveAuditLogPath } from "../ai-system/core/audit-log.js";
import { createApprovalArtifactBinding } from "../ai-system/approvals/approval-proof.js";
import { assertHermesAuth } from "../ai-system/mcp/auth.js";
import { executeMcpTool } from "../ai-system/mcp/tools.js";

describe("MCP tools", () => {
  test("auth validates Hermes token when configured", () => {
    assert.doesNotThrow(() => assertHermesAuth("Bearer hermes-token", "hermes-token"));
    assert.throws(() => assertHermesAuth("wrong", "hermes-token"), /Invalid Hermes token/);
  });

  test("creates, reads, runs, and cancels work items through service layer", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-tools-"));
    const queue = new FileBackedJobQueue(resolveJobQueueDirectory(tmp), async () => ({ ok: true } as any));
    const auditLog = new FileAuditLog(resolveAuditLogPath(tmp));
    const ctx = { defaultCwd: tmp, allowedRoots: [tmp], queue, auditLog, rules: { artifacts: { data_dir: ".artifacts" } } as any };

    try {
      const created = await executeMcpTool(ctx, "orchestra_create_work_item", {
        title: "MCP work",
        workflowProfile: "superpowers"
      }) as any;
      assert.equal(created.ok, true);
      assert.equal(created.workItem.workflowProfile, "superpowers");

      const loaded = await executeMcpTool(ctx, "orchestra_get_work_item", { workItemId: created.workItem.id }) as any;
      assert.equal(loaded.ok, true);

      const run = await executeMcpTool(ctx, "orchestra_run_work_item", { workItemId: created.workItem.id, dryRun: true }) as any;
      assert.equal(run.ok, true);
      assert.equal(run.jobs[0].workflowProfile, "superpowers");

      const cancelled = await executeMcpTool(ctx, "orchestra_cancel_work_item", { workItemId: created.workItem.id }) as any;
      assert.equal(cancelled.ok, true);
      assert.equal(cancelled.workItem.status, "cancelled");
    } finally {
      await queue.stop();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("approve step requires proof matching approval artifact", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-approve-"));
    const queue = new FileBackedJobQueue(resolveJobQueueDirectory(tmp), async () => ({ ok: true } as any));
    const auditLog = new FileAuditLog(resolveAuditLogPath(tmp));
    const pendingApprovals = new Map<string, any>();

    try {
      const job = await queue.enqueue({ task: "needs approval", cwd: tmp, dryRun: true });
      const binding = createApprovalArtifactBinding({ prompt: "plan", writeTargets: ["a.ts"] }, "plan");
      pendingApprovals.set(job.jobId, {
        type: "plan",
        data: { prompt: "plan", writeTargets: ["a.ts"] },
        binding,
        resolve: () => {}
      });
      const ctx = {
        defaultCwd: tmp,
        allowedRoots: [tmp],
        queue,
        auditLog,
        rules: { artifacts: { data_dir: ".artifacts" } } as any,
        pendingApprovals
      };

      await assert.rejects(
        () => executeMcpTool(ctx, "orchestra_approve_step", { jobId: job.jobId }),
        /Approval proof requires/
      );

      pendingApprovals.set(job.jobId, {
        type: "plan",
        data: { prompt: "plan", writeTargets: ["a.ts"] },
        binding,
        resolve: () => {}
      });
      const result = await executeMcpTool(ctx, "orchestra_approve_step", {
        jobId: job.jobId,
        approvalProof: {
          approvedBy: "operator",
          approvalSource: "mcp",
          userConfirmationId: "confirm-1",
          artifactId: binding.artifactId,
          artifactHash: binding.artifactHash
        }
      }) as any;
      assert.equal(result.approved, true);
    } finally {
      await queue.stop();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
