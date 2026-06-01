import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAuditEvent } from "./normalizers.js";
export class FileAuditLog {
    filePath;
    onEventCallback;
    constructor(filePath) {
        this.filePath = filePath;
    }
    setOnEvent(callback) {
        this.onEventCallback = callback;
    }
    async append(event) {
        const record = {
            version: 1,
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            ...event
        };
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
        if (this.onEventCallback) {
            this.onEventCallback(record);
        }
        return record;
    }
    async list(limit = 100) {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            return raw
                .split("\n")
                .filter(Boolean)
                .map((line) => normalizeAuditEvent(JSON.parse(line)))
                .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
                .slice(0, limit);
        }
        catch {
            return [];
        }
    }
    async runRetentionCleanup(days) {
        if (days <= 0)
            return 0;
        try {
            const events = await this.list(10000);
            const now = Date.now();
            const maxAgeMs = days * 24 * 60 * 60 * 1000;
            const filtered = events.filter((e) => now - new Date(e.timestamp).getTime() <= maxAgeMs);
            if (filtered.length === events.length) {
                return 0;
            }
            const content = filtered
                .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
                .map((e) => JSON.stringify(e))
                .join("\n") + (filtered.length > 0 ? "\n" : "");
            await fs.writeFile(this.filePath, content, "utf8");
            return events.length - filtered.length;
        }
        catch {
            return 0;
        }
    }
}
export function resolveAuditLogPath(defaultCwd) {
    return path.join(defaultCwd, ".ai-system-server", "audit.jsonl");
}
export function parseAuditActor(headers, rules) {
    const actorId = firstHeader(headers["x-ai-system-actor"]) || "dashboard";
    const roleHeader = firstHeader(headers["x-ai-system-role"]);
    // 1. Check for explicit mapping in rules
    if (rules?.auth?.role_mapping?.[actorId]) {
        return { id: actorId, role: rules.auth.role_mapping[actorId] };
    }
    // 2. Fallback to header or default
    const role = roleHeader === "admin" || roleHeader === "operator" || roleHeader === "viewer"
        ? roleHeader
        : "viewer";
    return {
        id: actorId,
        role
    };
}
export function roleCan(actor, required) {
    const rank = { viewer: 0, operator: 1, admin: 2 };
    return rank[actor.role] >= rank[required];
}
function firstHeader(value) {
    return Array.isArray(value) ? value[0] : value;
}
