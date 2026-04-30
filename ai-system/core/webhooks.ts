import type { AuditEvent } from "./audit-log.js";
import type { RulesConfig } from "../types.js";

export interface WebhookDispatchResult {
  url: string;
  action: string;
  delivered: boolean;
  preview: boolean;
  status?: number;
  error?: string;
}

/**
 * Sends webhook events based on system activity.
 */
export class WebhookManager {
  constructor(private readonly rules: RulesConfig) {}

  async dispatch(event: AuditEvent): Promise<WebhookDispatchResult[]> {
    const webhooks = this.rules.webhooks || [];
    const activeWebhooks = webhooks.filter(w => w.enabled && w.events.includes(event.action));

    if (activeWebhooks.length === 0) return [];

    const payload = this.preparePayload(event);

    return Promise.all(activeWebhooks.map(w => {
      if (w.dry_run) {
        return Promise.resolve({
          url: w.url,
          action: event.action,
          delivered: false,
          preview: true
        });
      }
      return this.send(w.url, payload, w.secret, event.action);
    }));
  }

  buildPreview(event: AuditEvent): any {
    return this.preparePayload(event);
  }

  private preparePayload(event: AuditEvent): any {
    return {
      version: 1,
      id: event.id,
      timestamp: event.timestamp,
      action: event.action,
      actor: event.actor,
      cwd: event.cwd,
      jobId: event.jobId,
      details: redactSecrets(event.details)
    };
  }

  private async send(url: string, payload: any, secret: string | undefined, action: string): Promise<WebhookDispatchResult> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (secret) {
        headers["X-AI-System-Webhook-Secret"] = secret;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return { url, action, delivered: false, preview: false, status: response.status };
      }
      return { url, action, delivered: true, preview: false, status: response.status };
    } catch (error) {
      return { url, action, delivered: false, preview: false, error: (error as Error).message };
    }
  }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /(token|key|secret|auth|password)/i.test(key) ? "[REDACTED]" : redactSecrets(entry)
    ])
  );
}
