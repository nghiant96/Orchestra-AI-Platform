import fs from "node:fs/promises";
import path from "node:path";
import { resolveRepoPath, shouldSkipPath } from "./context.js";
import { generateEmbedding, cosineSimilarity } from "../utils/embeddings.js";
import { toPosixPath } from "../utils/string.js";
import type { Logger, RulesConfig, VectorSearchConfig, VectorSearchMatch } from "../types.js";

interface VectorChunkRecord {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  preview: string;
  embedding: number[] | null;
}

interface IndexedFileRecord {
  path: string;
  mtimeMs: number;
  size: number;
  chunks: VectorChunkRecord[];
}

interface VectorIndexSnapshot {
  version: 1;
  config: {
    chunkSize: number;
    chunkOverlap: number;
    maxFileBytes: number;
    maxIndexedFiles: number;
  };
  files: IndexedFileRecord[];
}

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_MAX_RESULTS = 4;
const DEFAULT_MAX_INDEXED_FILES = 200;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".css",
  ".scss",
  ".html",
  ".yml",
  ".yaml",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift"
]);

export class VectorIndex {
  readonly repoRoot: string;
  readonly config: Required<Pick<VectorSearchConfig, "data_dir" | "max_results" | "max_indexed_files" | "max_file_bytes" | "chunk_size" | "chunk_overlap">>;
  readonly rules: RulesConfig;
  readonly logger?: Logger;

  constructor({
    repoRoot,
    rules,
    config,
    logger
  }: {
    repoRoot: string;
    rules: RulesConfig;
    config: VectorSearchConfig | undefined;
    logger?: Logger;
  }) {
    this.repoRoot = repoRoot;
    this.rules = rules;
    this.logger = logger;
    this.config = {
      data_dir: String(config?.data_dir || ".ai-system-vector"),
      max_results: numberOrDefault(config?.max_results, DEFAULT_MAX_RESULTS),
      max_indexed_files: numberOrDefault(config?.max_indexed_files, DEFAULT_MAX_INDEXED_FILES),
      max_file_bytes: numberOrDefault(config?.max_file_bytes, DEFAULT_MAX_FILE_BYTES),
      chunk_size: numberOrDefault(config?.chunk_size, DEFAULT_CHUNK_SIZE),
      chunk_overlap: numberOrDefault(config?.chunk_overlap, DEFAULT_CHUNK_OVERLAP)
    };
  }

  get enabled(): boolean {
    return this.rules.vector_search?.enabled === true;
  }

  get dataDir(): string {
    return path.join(this.repoRoot, this.config.data_dir);
  }

  get snapshotPath(): string {
    return path.join(this.dataDir, "index.json");
  }

  async indexWorkspace(): Promise<{ fileCount: number; chunkCount: number }> {
    const candidates = await collectCandidateFiles(this.repoRoot, this.rules, this.config.data_dir, this.config.max_indexed_files);
    const existingSnapshot = await this.readSnapshot();
    const existingFiles = new Map(existingSnapshot?.files.map((entry) => [entry.path, entry]));
    const files: IndexedFileRecord[] = [];

    for (const relativePath of candidates) {
      const absolutePath = resolveRepoPath(this.repoRoot, relativePath);
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile() || stat.size > this.config.max_file_bytes) {
        continue;
      }

      const cached = existingFiles.get(relativePath);
      if (
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size &&
        snapshotMatchesConfig(existingSnapshot, this.config)
      ) {
        files.push(cached);
        continue;
      }

      const content = await fs.readFile(absolutePath, "utf8");
      const chunks = await buildChunkRecords({
        relativePath,
        content,
        chunkSize: this.config.chunk_size,
        chunkOverlap: this.config.chunk_overlap
      });
      files.push({
        path: relativePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        chunks
      });
    }

    const snapshot: VectorIndexSnapshot = {
      version: 1,
      config: {
        chunkSize: this.config.chunk_size,
        chunkOverlap: this.config.chunk_overlap,
        maxFileBytes: this.config.max_file_bytes,
        maxIndexedFiles: this.config.max_indexed_files
      },
      files
    };
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

    return {
      fileCount: files.length,
      chunkCount: files.reduce((sum, file) => sum + file.chunks.length, 0)
    };
  }

  async search(query: string, maxResults = this.config.max_results): Promise<VectorSearchMatch[]> {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return [];
    }

    const snapshot = await this.readSnapshot();
    if (!snapshot || snapshot.files.length === 0) {
      return [];
    }

    const queryEmbedding = await generateEmbedding(trimmed);
    const queryTokens = tokenize(trimmed);
    const matches = snapshot.files
      .flatMap((file) => file.chunks)
      .map((chunk) => ({
        chunk,
        score: scoreChunk(chunk, queryTokens, queryEmbedding)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxResults)
      .map(({ chunk, score }) => ({
        id: chunk.id,
        path: chunk.path,
        score,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        preview: chunk.preview
      }));

    return matches;
  }

  private async readSnapshot(): Promise<VectorIndexSnapshot | null> {
    try {
      const raw = await fs.readFile(this.snapshotPath, "utf8");
      const parsed = JSON.parse(raw) as VectorIndexSnapshot;
      if (parsed?.version !== 1 || !Array.isArray(parsed?.files)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

async function collectCandidateFiles(
  repoRoot: string,
  rules: RulesConfig,
  vectorDataDir: string,
  maxIndexedFiles: number
): Promise<string[]> {
  const entries: string[] = [];
  const internalExcludedDirs = new Set([
    rules.artifacts?.data_dir ?? ".ai-system-artifacts",
    vectorDataDir || ".ai-system-vector"
  ]);
  await walk(repoRoot, "");
  return entries.slice(0, maxIndexedFiles);

  async function walk(absoluteDir: string, relativeDir: string): Promise<void> {
    const items = await fs.readdir(absoluteDir, { withFileTypes: true });
    items.sort((left, right) => left.name.localeCompare(right.name));

    for (const item of items) {
      const relativePath = toPosixPath(path.posix.join(relativeDir, item.name));
      if (shouldSkipPath(relativePath, rules) || isInternalIndexPath(relativePath, internalExcludedDirs)) {
        continue;
      }

      if (item.isDirectory()) {
        await walk(path.join(absoluteDir, item.name), relativePath);
        continue;
      }

      if (DEFAULT_SUPPORTED_EXTENSIONS.has(path.extname(relativePath))) {
        entries.push(relativePath);
      }
    }
  }
}

function isInternalIndexPath(relativePath: string, internalExcludedDirs: Set<string>): boolean {
  const normalized = toPosixPath(relativePath).replace(/\/+$/, "");
  for (const entry of internalExcludedDirs) {
    const candidate = toPosixPath(String(entry || "")).replace(/\/+$/, "");
    if (!candidate) {
      continue;
    }
    if (normalized === candidate || normalized.startsWith(`${candidate}/`)) {
      return true;
    }
  }
  return false;
}

async function buildChunkRecords({
  relativePath,
  content,
  chunkSize,
  chunkOverlap
}: {
  relativePath: string;
  content: string;
  chunkSize: number;
  chunkOverlap: number;
}): Promise<VectorChunkRecord[]> {
  const chunks = chunkText(content, chunkSize, chunkOverlap);
  const records: VectorChunkRecord[] = [];
  let index = 0;
  for (const chunk of chunks) {
    const embedding = await generateEmbedding(`${relativePath}\n${chunk.text}`);
    records.push({
      id: `${relativePath}#${index + 1}`,
      path: relativePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      preview: buildPreview(chunk.text),
      embedding
    });
    index += 1;
  }
  return records;
}

function chunkText(content: string, chunkSize: number, chunkOverlap: number): Array<{ text: string; startLine: number; endLine: number }> {
  const text = String(content || "");
  if (!text.trim()) {
    return [];
  }

  const safeChunkSize = Math.max(chunkSize, 200);
  const safeChunkOverlap = Math.min(Math.max(chunkOverlap, 0), Math.floor(safeChunkSize / 2));
  const lineOffsets = buildLineOffsets(text);
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + safeChunkSize, text.length);
    const chunkTextValue = text.slice(start, end).trim();
    if (chunkTextValue) {
      chunks.push({
        text: chunkTextValue,
        startLine: offsetToLine(start, lineOffsets),
        endLine: offsetToLine(Math.max(end - 1, start), lineOffsets)
      });
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(end - safeChunkOverlap, start + 1);
  }

  return chunks;
}

function buildLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function offsetToLine(offset: number, lineOffsets: number[]): number {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = lineOffsets[middle];
    const next = lineOffsets[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (offset >= value && offset < next) {
      return middle + 1;
    }
    if (offset < value) {
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return lineOffsets.length;
}

function scoreChunk(chunk: VectorChunkRecord, queryTokens: Set<string>, queryEmbedding: number[] | null): number {
  const chunkTokens = tokenize(`${chunk.path} ${chunk.preview} ${chunk.text}`);
  let keywordScore = 0;
  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      keywordScore += 1;
    }
  }

  const semanticScore = queryEmbedding && chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) * 8 : 0;
  return keywordScore + semanticScore + scorePathWeight(chunk.path);
}

function tokenize(text: string): Set<string> {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function buildPreview(text: string): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length <= 220 ? flattened : `${flattened.slice(0, 217)}...`;
}

function scorePathWeight(relativePath: string): number {
  const normalizedPath = toPosixPath(relativePath);
  const extension = path.extname(normalizedPath).toLowerCase();

  if (normalizedPath.startsWith("ai-system/core/") || normalizedPath.startsWith("docker/")) {
    return 4;
  }

  if (normalizedPath.startsWith("ai-system/") || normalizedPath.startsWith("src/") || normalizedPath.startsWith("packages/")) {
    return 2;
  }

  if (normalizedPath.startsWith("tests/")) {
    return 1;
  }

  if (normalizedPath === "README.md" || normalizedPath.startsWith("docs/") || normalizedPath.startsWith("tasks/")) {
    return -4;
  }

  if (extension === ".md" || extension === ".mdx") {
    return -3;
  }

  return 0;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function snapshotMatchesConfig(
  snapshot: VectorIndexSnapshot | null,
  config: Required<Pick<VectorSearchConfig, "chunk_size" | "chunk_overlap" | "max_file_bytes" | "max_indexed_files">>
): boolean {
  if (!snapshot) {
    return false;
  }
  return (
    snapshot.config.chunkSize === config.chunk_size &&
    snapshot.config.chunkOverlap === config.chunk_overlap &&
    snapshot.config.maxFileBytes === config.max_file_bytes &&
    snapshot.config.maxIndexedFiles === config.max_indexed_files
  );
}
