import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { truncate } from "./string.js";

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
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) {
        continue;
      }

      const equalsIndex = line.indexOf("=");
      if (equalsIndex === -1) {
        continue;
      }

      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore missing .env files.
  }
}

export async function runCommandWithRetry({
  command,
  args,
  cwd,
  input,
  timeoutMs = 60000,
  retries = 3,
  baseDelayMs = 500,
  label = command
}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await runCommand({ command, args, cwd, input, timeoutMs });
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableCliError(error)) {
        break;
      }
      await sleep(Math.min(baseDelayMs * 2 ** attempt, 8000));
    }
  }

  throw new Error(`${label} failed after ${retries + 1} attempt(s): ${lastError?.message ?? "Unknown error"}`);
}

export async function runCommand({ command, args, cwd, input, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectOnce(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      rejectOnce(new Error(`Failed to start ${command}: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }

      if (code === 0) {
        settled = true;
        resolve({ stdout, stderr, code });
        return;
      }

      const error = new Error(
        `Command failed: ${command} ${args.join(" ")} (code=${code ?? "null"}, signal=${signal ?? "none"}). stderr: ${truncate(stderr.trim(), 600)}`
      );
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      rejectOnce(error);
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();

    function rejectOnce(error) {
      clearTimeout(timeout);
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
  } finally {
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
  const message = `${error?.message ?? ""} ${error?.stderr ?? ""}`.toLowerCase();
  return ["timeout", "temporarily unavailable", "rate limit", "try again", "overloaded", "503", "429"].some((needle) =>
    message.includes(needle)
  );
}
