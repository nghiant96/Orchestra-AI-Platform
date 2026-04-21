import fs from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "../utils/string.js";

export async function buildProjectTree(repoRoot, rules) {
  const lines = ["."]; 
  const entries = [];
  const maxEntries = rules.max_tree_entries ?? 400;

  await walk(repoRoot, "", 0);

  for (const entry of entries.slice(0, maxEntries)) {
    lines.push(entry);
  }

  if (entries.length > maxEntries) {
    lines.push(`... truncated ${entries.length - maxEntries} entries`);
  }

  return lines.join("\n");

  async function walk(absoluteDir, relativeDir, depth) {
    if (depth > 8) {
      return;
    }

    const items = await fs.readdir(absoluteDir, { withFileTypes: true });
    items.sort((left, right) => left.name.localeCompare(right.name));

    for (const item of items) {
      const relativePath = toPosixPath(path.posix.join(relativeDir, item.name));
      if (shouldSkipPath(relativePath, rules)) {
        continue;
      }

      entries.push(relativePath + (item.isDirectory() ? "/" : ""));
      if (item.isDirectory()) {
        await walk(path.join(absoluteDir, item.name), relativePath, depth + 1);
      }
    }
  }
}

export async function readContextFiles(repoRoot, readFiles, rules, logger) {
  const contexts = [];
  const skippedFiles = [];
  let totalBytes = 0;

  for (const relativePath of readFiles) {
    const absolutePath = resolveRepoPath(repoRoot, relativePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const content = await fs.readFile(absolutePath, "utf8");
    const byteLength = Buffer.byteLength(content, "utf8");
    if (totalBytes + byteLength > rules.max_context_bytes) {
      skippedFiles.push(relativePath);
      continue;
    }

    totalBytes += byteLength;
    contexts.push({
      path: relativePath,
      content
    });
  }

  if (skippedFiles.length > 0) {
    logger?.warn(
      `Skipped ${skippedFiles.length} low-priority context file(s) because max_context_bytes=${rules.max_context_bytes} was reached.`
    );
  }

  return { contexts, skippedFiles };
}

export async function readOriginalFiles(repoRoot, filePaths) {
  const originals = new Map();

  for (const relativePath of filePaths) {
    const absolutePath = resolveRepoPath(repoRoot, relativePath);
    try {
      originals.set(relativePath, await fs.readFile(absolutePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        originals.set(relativePath, null);
      } else {
        throw error;
      }
    }
  }

  return originals;
}

export async function writeFilesAtomically(repoRoot, files, originals) {
  const writtenPaths = [];

  try {
    for (const file of files) {
      const absolutePath = resolveRepoPath(repoRoot, file.path);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      const tempPath = `${absolutePath}.ai-system.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tempPath, file.content, "utf8");
      await fs.rename(tempPath, absolutePath);
      writtenPaths.push(file.path);
    }
  } catch (error) {
    await rollbackWrittenFiles(repoRoot, writtenPaths, originals);
    throw error;
  }
}

export function resolveRepoPath(repoRoot, relativePath) {
  const normalized = toPosixPath(relativePath).replace(/^\.\/+/, "");
  const segments = normalized.split("/");
  if (!normalized || path.isAbsolute(normalized) || segments.includes("..")) {
    throw new Error(`Invalid path: ${relativePath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  const normalizedRoot = path.resolve(repoRoot);
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Path escapes repo root: ${relativePath}`);
  }

  return absolutePath;
}

export async function filterExistingSafeReadFiles(repoRoot, requestedFiles, rules, logger) {
  const allowed = [];

  for (const requestedPath of requestedFiles.slice(0, rules.max_files)) {
    try {
      const safePath = toPosixPath(requestedPath).replace(/^\.\/+/, "");
      if (!safePath || safePath.split("/").includes("..") || shouldSkipPath(safePath, rules) || isSensitiveFile(safePath, rules)) {
        logger?.warn(`Ignoring forbidden planner file: ${safePath}`);
        continue;
      }

      const absolutePath = resolveRepoPath(repoRoot, safePath);
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) {
        allowed.push(safePath);
      }
    } catch {
      logger?.warn(`Ignoring missing planner file: ${requestedPath}`);
    }
  }

  return dedupe(allowed);
}

export function filterSafeWriteTargets(targets, rules, logger) {
  const safeTargets = [];

  for (const target of targets.slice(0, rules.max_write_files ?? 8)) {
    const safePath = toPosixPath(target).replace(/^\.\/+/, "");
    if (!safePath) {
      continue;
    }

    if (path.posix.isAbsolute(safePath) || safePath.split("/").includes("..")) {
      logger?.warn(`Ignoring escaping write target: ${safePath}`);
      continue;
    }

    if (shouldSkipPath(safePath, rules) || isSensitiveFile(safePath, rules)) {
      logger?.warn(`Ignoring forbidden write target: ${safePath}`);
      continue;
    }

    safeTargets.push(safePath);
  }

  return dedupe(safeTargets);
}

export function shouldSkipPath(relativePath, rules) {
  const normalized = toPosixPath(relativePath).replace(/\/+$/, "");
  const excluded = rules.excluded_directories ?? [];
  return (
    excluded.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`)) ||
    isSensitiveFile(normalized, rules)
  );
}

function isSensitiveFile(relativePath, rules) {
  const fileName = path.posix.basename(relativePath);
  const sensitive = rules.sensitive_file_names ?? [];
  return sensitive.includes(fileName) || fileName.endsWith(".pem") || fileName.endsWith(".key");
}

function dedupe(values) {
  return [...new Set(values)];
}

async function rollbackWrittenFiles(repoRoot, writtenPaths, originals) {
  for (const relativePath of [...writtenPaths].reverse()) {
    const absolutePath = resolveRepoPath(repoRoot, relativePath);
    const original = originals.get(relativePath);
    if (original === null || typeof original === "undefined") {
      await fs.rm(absolutePath, { force: true });
    } else {
      await fs.writeFile(absolutePath, original, "utf8");
    }
  }
}
