import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { parseAuditActor } from "../ai-system/core/audit-log.js";
import { FileBackedJobQueue } from "../ai-system/core/job-queue.js";
import { WebhookManager } from "../ai-system/core/webhooks.js";
import type { AuditEvent } from "../ai-system/core/audit-log.js";
import type { RulesConfig } from "../ai-system/types.js";
import { listen, closeServer } from "./test-utils.js";

test("parseAuditActor applies configured identity role mapping before role headers", () => {
  const actor = parseAuditActor(
    {
      "x-ai-system-actor": "reviewer@example.com",
      "x-ai-system-role": "admin"
    },
    {
      auth: {
        role_mapping: {
          "reviewer@example.com": "viewer"
        }
      }
    } as unknown as RulesConfig
  );

  assert.deepEqual(actor, {
    id: "reviewer@example.com",
    role: "viewer"
  });
});

test("WebhookManager redacts nested secrets and delivers matching events", async () => {
  const received: any[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      received.push({
        secret: req.headers["x-ai-system-webhook-secret"],
        body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
      });
      res.writeHead(204);
      res.end();
    });
  });

  try {
    const url = await listen(server);
    const manager = new WebhookManager({
      webhooks: [
        {
          url,
          events: ["job.create"],
          secret: "shared-secret",
          enabled: true
        }
      ]
    } as RulesConfig);

    const results = await manager.dispatch(createAuditEvent({
      token: "abc",
      nested: {
        api_key: "def",
        safe: "visible"
      }
    }));

    assert.equal(results.length, 1);
    assert.equal(results[0]?.delivered, true);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.secret, "shared-secret");
    assert.equal(received[0]?.body.details.token, "[REDACTED]");
    assert.equal(received[0]?.body.details.nested.api_key, "[REDACTED]");
    assert.equal(received[0]?.body.details.nested.safe, "visible");
  } finally {
    await closeServer(server);
  }
});

test("WebhookManager dry-run webhooks create previews without network delivery", async () => {
  const manager = new WebhookManager({
    webhooks: [
      {
        url: "http://127.0.0.1:1/hook",
        events: ["job.create"],
        enabled: true,
        dry_run: true
      }
    ]
  } as RulesConfig);

  const results = await manager.dispatch(createAuditEvent({ password: "secret" }));
  assert.deepEqual(results, [
    {
      url: "http://127.0.0.1:1/hook",
      action: "job.create",
      delivered: false,
      preview: true
    }
  ]);
  assert.equal(manager.buildPreview(createAuditEvent({ password: "secret" })).details.password, "[REDACTED]");
});

test("FileBackedJobQueue retention removes old job records and keeps recent records", async () => {
  const jobsDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-system-queue-retention-"));
  const queue = new FileBackedJobQueue(
    jobsDir,
    async ({ task, cwd, dryRun }) => ({
      version: 1,
      ok: true,
      status: "completed",
      dryRun,
      repoRoot: cwd,
      configPath: null,
      plan: { prompt: task, readFiles: [], writeTargets: [], notes: [] },
      result: null,
      review: { approved: true, issues: [], summary: "" },
      iterations: [],
      artifacts: null,
      latestToolResults: [],
      execution: null
    } as any),
    { retentionDays: 1 }
  );

  try {
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(
      path.join(jobsDir, "old.json"),
      JSON.stringify(createQueueJob("old", "2020-01-01T00:00:00.000Z")),
      "utf8"
    );
    await fs.writeFile(
      path.join(jobsDir, "recent.json"),
      JSON.stringify(createQueueJob("recent", new Date().toISOString())),
      "utf8"
    );

    await queue.runRetentionCleanup();

    assert.equal(await exists(path.join(jobsDir, "old.json")), false);
    assert.equal(await exists(path.join(jobsDir, "recent.json")), true);
  } finally {
    await fs.rm(jobsDir, { recursive: true, force: true });
  }
});

function createAuditEvent(details: Record<string, unknown>): AuditEvent {
  return {
    version: 1,
    id: "evt-1",
    timestamp: "2026-04-30T00:00:00.000Z",
    action: "job.create",
    actor: { id: "tester", role: "operator" },
    cwd: "/repo",
    jobId: "job-1",
    details
  };
}

function createQueueJob(jobId: string, createdAt: string) {
  return {
    version: 1,
    jobId,
    status: "completed",
    task: jobId,
    cwd: "/repo",
    dryRun: true,
    createdAt,
    updatedAt: createdAt
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
