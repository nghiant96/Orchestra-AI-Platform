import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
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
  symbolName?: string;
}

interface IndexedFileRecord {
  path: string;
  mtimeMs: number;
  size: number;
  chunks: VectorChunkRecord[];
}

interface VectorIndexSnapshot {
  version: 3;
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
      version: 3,
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
      if (parsed?.version !== 3 || !Array.isArray(parsed?.files)) {
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
  const chunks = chunkText(relativePath, content, chunkSize, chunkOverlap);
  const records: VectorChunkRecord[] = [];
  let index = 0;
  for (const chunk of chunks) {
    const embedding = await generateEmbedding(
      [relativePath, chunk.symbolName ? `symbol ${chunk.symbolName}` : "", chunk.text].filter(Boolean).join("\n")
    );
    records.push({
      id: `${relativePath}#${index + 1}`,
      path: relativePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      preview: buildPreview(chunk.text),
      embedding,
      symbolName: chunk.symbolName
    });
    index += 1;
  }
  return records;
}

function chunkText(
  relativePath: string,
  content: string,
  chunkSize: number,
  chunkOverlap: number
): Array<{ text: string; startLine: number; endLine: number; symbolName?: string }> {
  const text = String(content || "");
  if (!text.trim()) {
    return [];
  }

  const symbolChunks = chunkTextBySymbols(relativePath, text, chunkSize);
  if (symbolChunks.length > 0) {
    return symbolChunks;
  }

  return chunkTextFixed(text, chunkSize, chunkOverlap);
}

function chunkTextBySymbols(
  relativePath: string,
  content: string,
  chunkSize: number
): Array<{ text: string; startLine: number; endLine: number; symbolName?: string }> {
  const text = String(content || "");
  if (!text.trim()) {
    return [];
  }

  const symbolRanges = detectSymbolRanges(relativePath, text);
  if (symbolRanges.length === 0) {
    return [];
  }

  const chunks: Array<{ text: string; startLine: number; endLine: number; symbolName?: string }> = [];
  const safeChunkSize = Math.max(chunkSize, 200);

  for (const current of symbolRanges) {
    const rawText = current.text.trim();
    if (!rawText) {
      continue;
    }

    if (rawText.length <= safeChunkSize * 1.25) {
      chunks.push({
        text: rawText,
        startLine: current.startLine,
        endLine: current.endLine,
        symbolName: current.symbolName
      });
      continue;
    }

    const nestedChunks = chunkTextFixed(rawText, safeChunkSize, Math.floor(safeChunkSize / 6));
    for (const nested of nestedChunks) {
      chunks.push({
        text: nested.text,
        startLine: current.startLine + nested.startLine - 1,
        endLine: current.startLine + nested.endLine - 1,
        symbolName: current.symbolName
      });
    }
  }

  return mergeAdjacentSmallChunks(chunks, safeChunkSize);
}

function chunkTextFixed(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): Array<{ text: string; startLine: number; endLine: number; symbolName?: string }> {
  const safeChunkSize = Math.max(chunkSize, 200);
  const safeChunkOverlap = Math.min(Math.max(chunkOverlap, 0), Math.floor(safeChunkSize / 2));
  const lineOffsets = buildLineOffsets(text);
  const chunks: Array<{ text: string; startLine: number; endLine: number; symbolName?: string }> = [];
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

function detectSymbolRanges(
  relativePath: string,
  content: string
): Array<{ startLine: number; endLine: number; text: string; symbolName?: string }> {
  const extension = path.extname(relativePath).toLowerCase();
  if (!isTypeScriptFamilyExtension(extension)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    resolveScriptKind(extension)
  );
  const ranges = extractTopLevelSymbolRanges(sourceFile, content);
  return dedupeAndSortSymbolRanges(ranges);
}

function extractTopLevelSymbolRanges(
  sourceFile: ts.SourceFile,
  content: string
): Array<{ startLine: number; endLine: number; text: string; symbolName?: string }> {
  const ranges: Array<{ startLine: number; endLine: number; text: string; symbolName?: string }> = [];
  for (const statement of sourceFile.statements) {
    for (const candidate of extractStatementSymbolNodes(statement)) {
      const range = buildSymbolRange(candidate.node, candidate.symbolName, sourceFile, content);
      if (range) {
        ranges.push(range);
      }
    }
  }
  return ranges;
}

function extractStatementSymbolNodes(
  statement: ts.Statement
): Array<{ node: ts.Node; symbolName?: string }> {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name?.text }];
  }

  if (ts.isModuleDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name.getText() }];
  }

  if (!ts.isVariableStatement(statement)) {
    return [];
  }

  const results: Array<{ node: ts.Node; symbolName?: string }> = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }
    const symbolName = declaration.name.text;
    const initializer = declaration.initializer;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) || ts.isClassExpression(initializer) || ts.isObjectLiteralExpression(initializer)) {
      results.push({ node: declaration, symbolName });
    }
  }
  return results;
}

function buildSymbolRange(
  node: ts.Node,
  symbolName: string | undefined,
  sourceFile: ts.SourceFile,
  content: string
): { startLine: number; endLine: number; text: string; symbolName?: string } | null {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  if (end <= start) {
    return null;
  }

  const text = content.slice(start, end).trim();
  if (!text) {
    return null;
  }

  const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(Math.max(end - 1, start)).line + 1;
  return {
    startLine,
    endLine,
    text,
    symbolName
  };
}

function dedupeAndSortSymbolRanges(
  ranges: Array<{ startLine: number; endLine: number; text: string; symbolName?: string }>
): Array<{ startLine: number; endLine: number; text: string; symbolName?: string }> {
  const seen = new Set<string>();
  return ranges
    .filter((entry) => {
      const key = `${entry.startLine}:${entry.endLine}:${entry.symbolName ?? ""}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
}

function isTypeScriptFamilyExtension(extension: string): boolean {
  return new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]).has(extension);
}

function resolveScriptKind(extension: string): ts.ScriptKind {
  switch (extension) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".js":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.Unknown;
  }
}

function mergeAdjacentSmallChunks(
  chunks: Array<{ text: string; startLine: number; endLine: number; symbolName?: string }>,
  chunkSize: number
): Array<{ text: string; startLine: number; endLine: number; symbolName?: string }> {
  if (chunks.length <= 1) {
    return chunks;
  }

  const merged: Array<{ text: string; startLine: number; endLine: number; symbolName?: string }> = [];
  let buffer = chunks[0];

  for (let index = 1; index < chunks.length; index += 1) {
    const current = chunks[index];
    if (
      buffer &&
      current &&
      !buffer.symbolName &&
      !current.symbolName &&
      buffer.text.length + current.text.length < chunkSize
    ) {
      buffer = {
        text: `${buffer.text}\n${current.text}`.trim(),
        startLine: buffer.startLine,
        endLine: current.endLine
      };
      continue;
    }

    merged.push(buffer);
    buffer = current;
  }

  if (buffer) {
    merged.push(buffer);
  }

  return merged;
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
  const chunkTokens = tokenize(`${chunk.path} ${chunk.symbolName ?? ""} ${chunk.preview} ${chunk.text}`);
  let keywordScore = 0;
  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      keywordScore += 1;
    }
  }

  const semanticScore = queryEmbedding && chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) * 8 : 0;
  return keywordScore + semanticScore + scorePathWeight(chunk.path) + (chunk.symbolName ? 1.5 : 0);
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
