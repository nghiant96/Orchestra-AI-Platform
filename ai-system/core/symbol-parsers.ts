import path from "node:path";
import ts from "typescript";

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
  parse(relativePath: string, content: string): CodeSymbolRange[];
}

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

export function getSymbolParserForPath(relativePath: string): CodeSymbolParser {
  const extension = path.extname(relativePath).toLowerCase();
  return SYMBOL_PARSERS.find((parser) => parser.extensions.includes(extension)) ?? PLAIN_TEXT_PARSER;
}

export function detectSymbolRanges(relativePath: string, content: string): CodeSymbolRange[] {
  return getSymbolParserForPath(relativePath).parse(relativePath, content);
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
