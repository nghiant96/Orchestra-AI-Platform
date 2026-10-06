import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { truncate } from "./string.js";
import { checkCommand } from "../security/command-policy.js";
import type { CliCommandError, CommandRetryOptions, CommandRunOptions, CommandRunResult } from "../types.js";

const DEFAULT_KILL_GRACE_MS = 5000;
/** Per-stream ceiling on captured command output, in characters. */
const DEFAULT_MAX_OUTPUT_CHARS = 10 * 1024 * 1024;

/**
 * Capture a child stream without unbounded growth. A command that floods its
 * output — a verbose test run, a runaway loop — was buffered in full until the
 * string hit V8's length limit, and that throw took the whole process down.
 * Only the tail is kept: failures and summaries land at the end, and the exit
 * code still decides success.
 */
export class OutputTail {
  private text = "";
  private totalBytes = 0;
  private dropped = false;

  constructor(private readonly maxChars: number) {}

  /** Characters held in memory right now — never more than twice the cap. */
  get retainedChars(): number {
    return this.text.length;
  }

  append(chunk: Buffer): void {
    this.totalBytes += chunk.length;
    this.text += chunk.toString();
    // Trim in batches rather than per chunk, so capture stays linear.
    if (this.text.length > this.maxChars * 2) {
      this.text = this.text.slice(-this.maxChars);
      this.dropped = true;
    }
  }

  get bytesSeen(): number {
    return this.totalBytes;
  }

  toString(): string {
    if (!this.dropped && this.text.length <= this.maxChars) {
      return this.text;
    }
    return `[output truncated: kept the last ${this.maxChars} characters of ${this.totalBytes} bytes]\n${this.text.slice(-this.maxChars)}`;
  }
}

export async function loadEnvironment(repoRoot = process.cwd()) {
  const envPath = path.join(repoRoot, ".env");

  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
      return;
    } catch {
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
  } catch {
    // Ignore missing .env files.
  }
}

export function parseEnvFileContent(raw: string): Record<string, string> {
  const lines = raw.split(/\r?\n/);
  const entries: Record<string, string> = {};

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
      const collected: string[] = [rawValue.slice(1)];

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

export async function runCommandWithRetry({
  retries = 3,
  baseDelayMs = 500,
  label,
  onMonitor,
  ...runOptions
}: CommandRetryOptions): Promise<CommandRunResult> {
  // Forward every run option rather than re-listing them: a hand-copied list
  // once dropped `env`, which silently turned the clean-env sandbox into a
  // full inheritance of the server's secrets.
  const { signal } = runOptions;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('AbortError');
    }

    try {
      return await runCommand({
        ...runOptions,
        onMonitor: typeof onMonitor === "function" ? (event) => onMonitor({ ...event, attempt }) : undefined
      });
    } catch (error) {
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

  const error = lastError as CliCommandError | undefined;
  const wrapped: CliCommandError = new Error(`${label ?? runOptions.command} failed after ${retries + 1} attempt(s): ${error?.message ?? "Unknown error"}`);
  wrapped.code = error?.code;
  wrapped.stdout = error?.stdout;
  wrapped.stderr = error?.stderr;
  throw wrapped;
}

export async function runCommand({
  command,
  args,
  cwd,
  env,
  input,
  stdinMode = "pipe",
  timeoutMs = 60000,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  monitorIntervalMs = 0,
  onMonitor,
  signal,
  maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS
}: CommandRunOptions): Promise<CommandRunResult> {
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

    const stdoutTail = new OutputTail(maxOutputChars);
    const stderrTail = new OutputTail(maxOutputChars);
    let settled = false;
    let nextMonitorId = 1;
    let forceKillTimeout: NodeJS.Timeout | null = null;

    const abortHandler = () => {
      cleanup(new Error('AbortError'));
    };
    signal?.addEventListener('abort', abortHandler);

    const timeout =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            cleanup(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
          }, timeoutMs)
        : null;

    function cleanup(error?: Error) {
      if (settled) return;
      
      if (error) {
        // Kill the process group if detached, otherwise just the child
        if (child.pid) {
          try {
            if (process.platform !== 'win32') {
              process.kill(-child.pid, 'SIGTERM');
            } else {
              child.kill('SIGTERM');
            }
          } catch { /* ignore */ }

          if (Number.isFinite(killGraceMs) && killGraceMs >= 0) {
            forceKillTimeout = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null && child.pid) {
                try {
                  if (process.platform !== 'win32') {
                    process.kill(-child.pid, 'SIGKILL');
                  } else {
                    child.kill('SIGKILL');
                  }
                } catch { /* ignore */ }
              }
            }, killGraceMs);
          }
        }
        rejectOnce(error, { preserveForceKill: true });
      }
    }
    const monitor =
      Number.isFinite(monitorIntervalMs) && monitorIntervalMs > 0 && typeof onMonitor === "function"
        ? setInterval(() => {
            onMonitor({
              command,
              args,
              cwd,
              elapsedMs: Date.now() - startedAt,
              stdoutBytes: stdoutTail.bytesSeen,
              stderrBytes: stderrTail.bytesSeen,
              monitorId: nextMonitorId
            });
            nextMonitorId += 1;
          }, monitorIntervalMs)
        : null;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutTail.append(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail.append(chunk);
    });

    child.on("error", (error) => {
      rejectOnce(new Error(`Failed to start ${command}: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimers();
      if (settled) {
        return;
      }

      const stdout = stdoutTail.toString();
      const stderr = stderrTail.toString();
      if (code === 0) {
        settled = true;
        resolve({ stdout, stderr, code });
        return;
      }

      const error: CliCommandError = new Error(
        `Command failed: ${command} ${args.join(" ")} (code=${code ?? "null"}, signal=${signal ?? "none"}). stderr: ${truncate(stderr.trim(), 600)}`
      );
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

    function clearTimers({ preserveForceKill = false }: { preserveForceKill?: boolean } = {}): void {
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

    function rejectOnce(error: unknown, { preserveForceKill = false }: { preserveForceKill?: boolean } = {}) {
      clearTimers({ preserveForceKill });
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}

export async function withTempDir<T>(prefix: string, callback: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableCliError(error: unknown) {
  const normalized = error as CliCommandError | undefined;
  const message = `${normalized?.message ?? ""} ${normalized?.stderr ?? ""}`.toLowerCase();
  return ["timeout", "temporarily unavailable", "rate limit", "try again", "overloaded", "503", "429", "quota exceeded", "capacity"].some((needle) =>
    message.includes(needle)
  );
}

function findClosingQuote(value: string, quote: '"' | "'"): number {
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

function stripInlineComment(value: string): string {
  const match = value.match(/^(.*?)(?:\s+#.*)?$/);
  return match?.[1]?.trimEnd() ?? value.trimEnd();
}
