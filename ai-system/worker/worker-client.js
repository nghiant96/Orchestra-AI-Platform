export class WorkerApiClient {
    options;
    constructor(options) {
        this.options = options;
    }
    async register(input) {
        return this.requestJson("/workers", {
            method: "POST",
            body: input
        });
    }
    async heartbeat(workerId, input) {
        return this.requestJson(`/workers/${encodeURIComponent(workerId)}/heartbeat`, {
            method: "POST",
            body: input
        });
    }
    async claim(workerId) {
        return this.requestJson(`/workers/${encodeURIComponent(workerId)}/jobs/claim`, {
            method: "POST",
            body: {}
        });
    }
    async complete(workerId, jobId, leaseId, result) {
        return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/complete`, {
            method: "POST",
            body: { workerId, leaseId, ...result }
        });
    }
    async fail(workerId, jobId, leaseId, message, result) {
        return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/fail`, {
            method: "POST",
            body: { workerId, leaseId, message, ...result }
        });
    }
    async checkpoint(workerId, jobId, leaseId, checkpoint) {
        return this.requestJson(`/jobs/${encodeURIComponent(jobId)}/checkpoint`, {
            method: "POST",
            body: { workerId, leaseId, ...checkpoint }
        });
    }
    async uploadLogs(workerId, jobId, leaseId, lines) {
        return this.requestJson(`/workers/${encodeURIComponent(workerId)}/jobs/${encodeURIComponent(jobId)}/logs`, {
            method: "POST",
            body: { leaseId, lines }
        });
    }
    async requestJson(pathname, options) {
        const headers = {
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
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok) {
            throw new Error(parsed?.error || `HTTP ${response.status} for ${pathname}`);
        }
        return parsed;
    }
}
