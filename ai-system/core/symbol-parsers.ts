import path from "node:path";
import ts from "typescript";
import type { Logger, VectorParserConfig, VectorParserMode } from "../types.js";

export interface CodeSymbolRange {
  startLine: number;
  endLine: number;
  text: string;
  symbolName?: string;
  kind?: string;
}

export interface CodeSymbolParser {
  id: string;
  extensions: string[];
  parse(relativePath: string, content: string): CodeSymbolRange[] | Promise<CodeSymbolRange[]>;
}

export interface SymbolParserOptions {
  parserConfig?: VectorParserConfig;
  logger?: Logger;
  treeSitterParseOverride?: TreeSitterParseOverride;
}

export type TreeSitterParseOverride = (
  relativePath: string,
  content: string,
  language: TreeSitterLanguageName
) => CodeSymbolRange[] | null | Promise<CodeSymbolRange[] | null>;

type TreeSitterLanguageName = "python" | "go" | "rust";

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

class TypeScriptSymbolParser implements CodeSymbolParser {
  id = "typescript";
  extensions = TYPESCRIPT_EXTENSIONS;

  parse(relativePath: string, content: string): CodeSymbolRange[] {
    const extension = path.extname(relativePath).toLowerCase();
    const sourceFile = ts.createSourceFile(
      relativePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      resolveScriptKind(extension)
    );
    return dedupeAndSortSymbolRanges(extractTopLevelSymbolRanges(sourceFile, content));
  }
}

class LineBasedSymbolParser implements CodeSymbolParser {
  id: string;
  extensions: string[];
  private matcher: (line: string) => { symbolName: string; kind: string } | null;

  constructor({
    id,
    extensions,
    matcher
  }: {
    id: string;
    extensions: string[];
    matcher: (line: string) => { symbolName: string; kind: string } | null;
  }) {
    this.id = id;
    this.extensions = extensions;
    this.matcher = matcher;
  }

  parse(_relativePath: string, content: string): CodeSymbolRange[] {
    const lines = content.split(/\r?\n/);
    const starts: Array<{ lineIndex: number; symbolName: string; kind: string }> = [];

    for (let index = 0; index < lines.length; index += 1) {
      const match = this.matcher(lines[index] ?? "");
      if (match) {
        starts.push({ lineIndex: index, ...match });
      }
    }

    return dedupeAndSortSymbolRanges(
      starts
        .map((start, index): CodeSymbolRange | null => {
          const nextStart = starts[index + 1]?.lineIndex ?? lines.length;
          const endIndex = Math.max(start.lineIndex, nextStart - 1);
          const text = lines.slice(start.lineIndex, endIndex + 1).join("\n").trim();
          if (!text) {
            return null;
          }
          return {
            startLine: start.lineIndex + 1,
            endLine: endIndex + 1,
            text,
            symbolName: start.symbolName,
            kind: start.kind
          };
        })
        .filter((entry): entry is CodeSymbolRange => entry !== null)
    );
  }
}

class PlainTextSymbolParser implements CodeSymbolParser {
  id = "plain-text";
  extensions: string[] = [];

  parse(): CodeSymbolRange[] {
    return [];
  }
}

const SYMBOL_PARSERS: CodeSymbolParser[] = [
  new TypeScriptSymbolParser(),
  new LineBasedSymbolParser({
    id: "python-line",
    extensions: [".py"],
    matcher: (line) => {
      const symbolName = matchFirstGroup(line, /^\s*(?:async\s+def|def)\s+([A-Za-z_]\w*)\b/);
      if (symbolName) return { symbolName, kind: "function" };
      const className = matchFirstGroup(line, /^\s*class\s+([A-Za-z_]\w*)\b/);
      return className ? { symbolName: className, kind: "class" } : null;
    }
  }),
  new LineBasedSymbolParser({
    id: "go-line",
    extensions: [".go"],
    matcher: (line) => {
      const functionName = matchFirstGroup(line, /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/);
      if (functionName) return { symbolName: functionName, kind: "function" };
      const typeName = matchFirstGroup(line, /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/);
      return typeName ? { symbolName: typeName, kind: "type" } : null;
    }
  }),
  new LineBasedSymbolParser({
    id: "rust-line",
    extensions: [".rs"],
    matcher: (line) => {
      const symbolName =
        matchFirstGroup(line, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\b/) ??
        matchFirstGroup(line, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)\b/) ??
        matchFirstGroup(line, /^\s*(?:pub(?:\([^)]*\))?\s+)?impl(?:<[^>]+>)?\s+([A-Za-z_]\w*)\b/);
      return symbolName ? { symbolName, kind: "symbol" } : null;
    }
  }),
  new LineBasedSymbolParser({
    id: "java-line",
    extensions: [".java"],
    matcher: (line) => {
      const className = matchFirstGroup(
        line,
        /^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b/
      );
      if (className) return { symbolName: className, kind: "type" };
      const methodName = matchFirstGroup(
        line,
        /^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)+[A-Za-z_<>, ?]+\s+([A-Za-z_]\w*)\s*\(/
      );
      return methodName ? { symbolName: methodName, kind: "function" } : null;
    }
  }),
  new LineBasedSymbolParser({
    id: "kotlin-line",
    extensions: [".kt"],
    matcher: (line) => {
      const className = matchFirstGroup(
        line,
        /^\s*(?:public|private|protected|internal|data|sealed|open|abstract|final|\s)*\s*(?:class|interface|object|enum\s+class)\s+([A-Za-z_]\w*)\b/
      );
      if (className) return { symbolName: className, kind: "type" };
      const functionName = matchFirstGroup(
        line,
        /^\s*(?:public|private|protected|internal|suspend|inline|operator|override|\s)*\s*fun\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*\(/
      );
      return functionName ? { symbolName: functionName, kind: "function" } : null;
    }
  }),
  new LineBasedSymbolParser({
    id: "swift-line",
    extensions: [".swift"],
    matcher: (line) => {
      const className = matchFirstGroup(
        line,
        /^\s*(?:public|private|fileprivate|internal|open|final|\s)*\s*(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)\b/
      );
      if (className) return { symbolName: className, kind: "type" };
      const functionName = matchFirstGroup(
        line,
        /^\s*(?:public|private|fileprivate|internal|open|static|class|mutating|\s)*\s*func\s+([A-Za-z_]\w*)\s*\(/
      );
      return functionName ? { symbolName: functionName, kind: "function" } : null;
    }
  })
];

const PLAIN_TEXT_PARSER = new PlainTextSymbolParser();
const TREE_SITTER_LANGUAGE_BY_EXTENSION: Partial<Record<string, TreeSitterLanguageName>> = {
  ".py": "python",
  ".go": "go",
  ".rs": "rust"
};

class TreeSitterSymbolParser implements CodeSymbolParser {
  id = "tree-sitter";
  extensions = [".py", ".go", ".rs"];

  async parse(relativePath: string, content: string, options: SymbolParserOptions = {}): Promise<CodeSymbolRange[]> {
    const language = TREE_SITTER_LANGUAGE_BY_EXTENSION[path.extname(relativePath).toLowerCase()];
    if (!language) {
      return [];
    }

    try {
      const overridden = await options.treeSitterParseOverride?.(relativePath, content, language);
      if (overridden) {
        return dedupeAndSortSymbolRanges(overridden);
      }

      const parserModule = await importOptionalModule("tree-sitter");
      const grammarModule = await importOptionalModule(resolveTreeSitterGrammarPackage(language));
      if (!parserModule || !grammarModule) {
        options.logger?.info(`Tree-sitter parser unavailable for ${language}; falling back to line-based symbol parsing.`);
        return [];
      }

      const ParserCtor = getDefaultExport(parserModule);
      const grammar = getTreeSitterGrammarExport(grammarModule, language);
      const parser = new ParserCtor();
      parser.setLanguage(grammar);
      const tree = parser.parse(content);
      const ranges = extractTreeSitterRanges(tree.rootNode, content, language);
      return dedupeAndSortSymbolRanges(ranges);
    } catch (error) {
      options.logger?.warn(`Tree-sitter parser failed for ${relativePath}; falling back to line-based parsing: ${(error as Error).message}`);
      return [];
    }
  }
}

const TREE_SITTER_PARSER = new TreeSitterSymbolParser();

export function getSymbolParserForPath(relativePath: string): CodeSymbolParser {
  const extension = path.extname(relativePath).toLowerCase();
  return SYMBOL_PARSERS.find((parser) => parser.extensions.includes(extension)) ?? PLAIN_TEXT_PARSER;
}

export async function detectSymbolRanges(
  relativePath: string,
  content: string,
  options: SymbolParserOptions = {}
): Promise<CodeSymbolRange[]> {
  const extension = path.extname(relativePath).toLowerCase();
  const mode = normalizeParserMode(options.parserConfig?.mode);
  const baseParser = getSymbolParserForPath(relativePath);
  const isTypeScriptFamily = TYPESCRIPT_EXTENSIONS.includes(extension);

  try {
    if (mode === "typescript-only") {
      return isTypeScriptFamily ? await baseParser.parse(relativePath, content) : [];
    }

    if (shouldTryTreeSitter(relativePath, mode, options.parserConfig)) {
      const treeSitterRanges = await TREE_SITTER_PARSER.parse(relativePath, content, options);
      if (treeSitterRanges.length > 0) {
        return treeSitterRanges;
      }
    }

    return await baseParser.parse(relativePath, content);
  } catch (error) {
    options.logger?.warn(`Symbol parser failed for ${relativePath}; falling back to fixed chunking: ${(error as Error).message}`);
    return [];
  }
}

function shouldTryTreeSitter(relativePath: string, mode: VectorParserMode, config: VectorParserConfig | undefined): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  const language = TREE_SITTER_LANGUAGE_BY_EXTENSION[extension];
  if (!language) {
    return false;
  }
  if (mode !== "auto" && mode !== "tree-sitter") {
    return false;
  }
  const configuredLanguages = config?.tree_sitter_languages;
  if (configuredLanguages && configuredLanguages.length > 0) {
    return configuredLanguages.map((entry) => entry.toLowerCase()).includes(language);
  }
  return mode === "tree-sitter";
}

function normalizeParserMode(value: unknown): VectorParserMode {
  return value === "typescript-only" || value === "line-based" || value === "tree-sitter" ? value : "auto";
}

async function importOptionalModule(moduleName: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(moduleName)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveTreeSitterGrammarPackage(language: TreeSitterLanguageName): string {
  return `tree-sitter-${language}`;
}

function getDefaultExport(moduleValue: Record<string, unknown>): any {
  return moduleValue.default ?? moduleValue;
}

function getTreeSitterGrammarExport(moduleValue: Record<string, unknown>, language: TreeSitterLanguageName): any {
  return moduleValue.default ?? moduleValue[language] ?? moduleValue;
}

function extractTreeSitterRanges(rootNode: any, content: string, language: TreeSitterLanguageName): CodeSymbolRange[] {
  const ranges: CodeSymbolRange[] = [];
  visitTreeSitterNode(rootNode, (node) => {
    const kind = classifyTreeSitterNode(node.type, language);
    if (!kind) {
      return;
    }
    const symbolName = extractTreeSitterSymbolName(node);
    const startLine = Number(node.startPosition?.row ?? 0) + 1;
    const endLine = Number(node.endPosition?.row ?? node.startPosition?.row ?? 0) + 1;
    const text = String(content).split(/\r?\n/).slice(startLine - 1, endLine).join("\n").trim();
    if (text) {
      ranges.push({ startLine, endLine, text, symbolName, kind });
    }
  });
  return ranges;
}

function visitTreeSitterNode(node: any, visitor: (node: any) => void): void {
  if (!node) {
    return;
  }
  visitor(node);
  const childCount = Number(node.namedChildCount ?? node.childCount ?? 0);
  for (let index = 0; index < childCount; index += 1) {
    visitTreeSitterNode(node.namedChild?.(index) ?? node.child?.(index), visitor);
  }
}

function classifyTreeSitterNode(type: unknown, language: TreeSitterLanguageName): string | null {
  const nodeType = String(type || "");
  if (language === "python") {
    if (nodeType === "function_definition") return "function";
    if (nodeType === "class_definition") return "class";
  }
  if (language === "go") {
    if (nodeType === "function_declaration" || nodeType === "method_declaration") return "function";
    if (nodeType === "type_declaration") return "type";
  }
  if (language === "rust") {
    if (nodeType === "function_item") return "function";
    if (nodeType === "struct_item" || nodeType === "enum_item" || nodeType === "trait_item" || nodeType === "impl_item") {
      return "type";
    }
  }
  return null;
}

function extractTreeSitterSymbolName(node: any): string | undefined {
  const namedNode = node.childForFieldName?.("name");
  if (typeof namedNode?.text === "string" && namedNode.text.trim()) {
    return namedNode.text.trim();
  }
  const childCount = Number(node.namedChildCount ?? node.childCount ?? 0);
  for (let index = 0; index < childCount; index += 1) {
    const child = node.namedChild?.(index) ?? node.child?.(index);
    if (child?.type === "identifier" && typeof child.text === "string") {
      return child.text.trim();
    }
  }
  return undefined;
}

function extractTopLevelSymbolRanges(sourceFile: ts.SourceFile, content: string): CodeSymbolRange[] {
  const ranges: CodeSymbolRange[] = [];
  for (const statement of sourceFile.statements) {
    for (const candidate of extractStatementSymbolNodes(statement)) {
      const range = buildSymbolRange(candidate.node, candidate.symbolName, candidate.kind, sourceFile, content);
      if (range) {
        ranges.push(range);
      }
    }
  }
  return ranges;
}

function extractStatementSymbolNodes(
  statement: ts.Statement
): Array<{ node: ts.Node; symbolName?: string; kind: string }> {
  if (ts.isFunctionDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name?.text, kind: "function" }];
  }
  if (ts.isClassDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name?.text, kind: "class" }];
  }
  if (ts.isInterfaceDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name?.text, kind: "interface" }];
  }
  if (ts.isEnumDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name?.text, kind: "enum" }];
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name?.text, kind: "type" }];
  }

  if (ts.isModuleDeclaration(statement)) {
    return [{ node: statement, symbolName: statement.name.getText(), kind: "module" }];
  }

  if (!ts.isVariableStatement(statement)) {
    return [];
  }

  const results: Array<{ node: ts.Node; symbolName?: string; kind: string }> = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }
    const symbolName = declaration.name.text;
    const initializer = declaration.initializer;
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      results.push({ node: declaration, symbolName, kind: "function" });
    } else if (ts.isClassExpression(initializer)) {
      results.push({ node: declaration, symbolName, kind: "class" });
    } else if (ts.isObjectLiteralExpression(initializer)) {
      results.push({ node: declaration, symbolName, kind: "object" });
    }
  }
  return results;
}

function buildSymbolRange(
  node: ts.Node,
  symbolName: string | undefined,
  kind: string,
  sourceFile: ts.SourceFile,
  content: string
): CodeSymbolRange | null {
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
    symbolName,
    kind
  };
}

function dedupeAndSortSymbolRanges(ranges: CodeSymbolRange[]): CodeSymbolRange[] {
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

function matchFirstGroup(line: string, pattern: RegExp): string | null {
  return pattern.exec(line)?.[1] ?? null;
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
