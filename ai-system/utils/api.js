import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { truncate } from "./string.js";
import { checkCommand } from "../security/command-policy.js";
const DEFAULT_KILL_GRACE_MS = 5000;
export async function loadEnvironment(repoRoot = process.cwd()) {
    const envPath = path.join(repoRoot, ".env");
    if (typeof process.loadEnvFile === "function") {
        try {
            process.loadEnvFile(envPath);
            return;
        }
        catch {
            return;
        }
    }
    try {
        const raw = await fs.readFile(envPath, "utf8");
        const entries = parseEnvFileContent(raw);
        for (const [key, value] of Object.entries(entries)) {
            if (!(key in process.env)) {
                process.env[key] = value;
            }
        }
    }
    catch {
        // Ignore missing .env files.
    }
}
export function parseEnvFileContent(raw) {
    const lines = raw.split(/\r?\n/);
    const entries = {};
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const equalsIndex = line.indexOf("=");
        if (equalsIndex === -1) {
            continue;
        }
        const rawKey = line.slice(0, equalsIndex).trim().replace(/^export\s+/, "");
        if (!rawKey) {
            continue;
        }
        const rawValue = line.slice(equalsIndex + 1).trimStart();
        if (!rawValue) {
            entries[rawKey] = "";
            continue;
        }
        const quote = rawValue[0];
        if (quote === '"' || quote === "'") {
            const collected = [rawValue.slice(1)];
            while (true) {
                const segment = collected[collected.length - 1];
                const quoteIndex = findClosingQuote(segment, quote);
                if (quoteIndex !== -1) {
                    collected[collected.length - 1] = segment.slice(0, quoteIndex);
                    break;
                }
                index += 1;
                if (index >= lines.length) {
                    break;
                }
                collected.push(lines[index]);
            }
            entries[rawKey] = collected.join("\n");
            continue;
        }
        entries[rawKey] = stripInlineComment(rawValue);
    }
    return entries;
}
export async function runCommandWithRetry({ command, args, cwd, input, timeoutMs = 60000, killGraceMs = DEFAULT_KILL_GRACE_MS, retries = 3, baseDelayMs = 500, label = command, monitorIntervalMs = 0, onMonitor, signal }) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (signal?.aborted) {
            throw new Error('AbortError');
        }
        try {
            return await runCommand({
                command,
                args,
                cwd,
                input,
                timeoutMs,
                killGraceMs,
                monitorIntervalMs,
                onMonitor: typeof onMonitor === "function" ? (event) => onMonitor({ ...event, attempt }) : undefined,
                signal
            });
        }
        catch (error) {
            lastError = error;
            if (attempt === retries || !isRetryableCliError(error) || signal?.aborted) {
                break;
            }
            await sleep(Math.min(baseDelayMs * 2 ** attempt, 8000));
        }
    }
    if (signal?.aborted) {
        throw new Error('AbortError');
    }
    const error = lastError;
    const wrapped = new Error(`${label} failed after ${retries + 1} attempt(s): ${error?.message ?? "Unknown error"}`);
    wrapped.code = error?.code;
    wrapped.stdout = error?.stdout;
    wrapped.stderr = error?.stderr;
    throw wrapped;
}
export async function runCommand({ command, args, cwd, env, input, stdinMode = "pipe", timeoutMs = 60000, killGraceMs = DEFAULT_KILL_GRACE_MS, monitorIntervalMs = 0, onMonitor, signal }) {
    if (signal?.aborted) {
        return Promise.reject(new Error('AbortError'));
    }
    const commandLine = [command, ...args].join(" ").trim();
    const policy = checkCommand(commandLine);
    if (!policy.allowed) {
        return Promise.reject(new Error(policy.reason ?? `Blocked command: ${commandLine}`));
    }
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const child = spawn(command, args, {
            cwd,
            env: env ?? process.env,
            stdio: [stdinMode, "pipe", "pipe"],
            detached: process.platform !== 'win32' // Use detached to kill process group if needed
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let nextMonitorId = 1;
        let forceKillTimeout = null;
        const abortHandler = () => {
            cleanup(new Error('AbortError'));
        };
        signal?.addEventListener('abort', abortHandler);
        const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
            ? setTimeout(() => {
                cleanup(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
            }, timeoutMs)
            : null;
        function cleanup(error) {
            if (settled)
                return;
            if (error) {
                // Kill the process group if detached, otherwise just the child
                if (child.pid) {
                    try {
                        if (process.platform !== 'win32') {
                            process.kill(-child.pid, 'SIGTERM');
                        }
                        else {
                            child.kill('SIGTERM');
                        }
                    }
                    catch { /* ignore */ }
                    if (Number.isFinite(killGraceMs) && killGraceMs >= 0) {
                        forceKillTimeout = setTimeout(() => {
                            if (child.exitCode === null && child.signalCode === null && child.pid) {
                                try {
                                    if (process.platform !== 'win32') {
                                        process.kill(-child.pid, 'SIGKILL');
                                    }
                                    else {
                                        child.kill('SIGKILL');
                                    }
                                }
                                catch { /* ignore */ }
                            }
                        }, killGraceMs);
                    }
                }
                rejectOnce(error, { preserveForceKill: true });
            }
        }
        const monitor = Number.isFinite(monitorIntervalMs) && monitorIntervalMs > 0 && typeof onMonitor === "function"
            ? setInterval(() => {
                onMonitor({
                    command,
                    args,
                    cwd,
                    elapsedMs: Date.now() - startedAt,
                    stdoutBytes: Buffer.byteLength(stdout, "utf8"),
                    stderrBytes: Buffer.byteLength(stderr, "utf8"),
                    monitorId: nextMonitorId
                });
                nextMonitorId += 1;
            }, monitorIntervalMs)
            : null;
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            rejectOnce(new Error(`Failed to start ${command}: ${error.message}`));
        });
        child.on("close", (code, signal) => {
            clearTimers();
            if (settled) {
                return;
            }
            if (code === 0) {
                settled = true;
                resolve({ stdout, stderr, code });
                return;
            }
            const error = new Error(`Command failed: ${command} ${args.join(" ")} (code=${code ?? "null"}, signal=${signal ?? "none"}). stderr: ${truncate(stderr.trim(), 600)}`);
            error.code = code;
            error.stdout = stdout;
            error.stderr = stderr;
            rejectOnce(error);
        });
        if (stdinMode === "pipe") {
            if (child.stdin) {
                if (input) {
                    child.stdin.write(input);
                }
                child.stdin.end();
            }
        }
        function clearTimers({ preserveForceKill = false } = {}) {
            if (timeout) {
                clearTimeout(timeout);
            }
            if (monitor) {
                clearInterval(monitor);
            }
            if (!preserveForceKill && forceKillTimeout) {
                clearTimeout(forceKillTimeout);
                forceKillTimeout = null;
            }
            if (signal && abortHandler) {
                signal.removeEventListener('abort', abortHandler);
            }
        }
        function rejectOnce(error, { preserveForceKill = false } = {}) {
            clearTimers({ preserveForceKill });
            if (!settled) {
                settled = true;
                reject(error);
            }
        }
    });
}
export async function withTempDir(prefix, callback) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    try {
        return await callback(tempDir);
    }
    finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}
export async function writeJsonFile(filePath, value) {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRetryableCliError(error) {
    const normalized = error;
    const message = `${normalized?.message ?? ""} ${normalized?.stderr ?? ""}`.toLowerCase();
    return ["timeout", "temporarily unavailable", "rate limit", "try again", "overloaded", "503", "429", "quota exceeded", "capacity"].some((needle) => message.includes(needle));
}
function findClosingQuote(value, quote) {
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === quote) {
            return index;
        }
    }
    return -1;
}
function stripInlineComment(value) {
    const match = value.match(/^(.*?)(?:\s+#.*)?$/);
    return match?.[1]?.trimEnd() ?? value.trimEnd();
}
