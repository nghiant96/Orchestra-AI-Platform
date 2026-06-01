import path from "node:path";
import ts from "typescript";
const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
class TypeScriptSymbolParser {
    id = "typescript";
    extensions = TYPESCRIPT_EXTENSIONS;
    parse(relativePath, content) {
        const extension = path.extname(relativePath).toLowerCase();
        const sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true, resolveScriptKind(extension));
        return dedupeAndSortSymbolRanges(extractTopLevelSymbolRanges(sourceFile, content));
    }
}
class LineBasedSymbolParser {
    id;
    extensions;
    matcher;
    constructor({ id, extensions, matcher }) {
        this.id = id;
        this.extensions = extensions;
        this.matcher = matcher;
    }
    parse(_relativePath, content) {
        const lines = content.split(/\r?\n/);
        const starts = [];
        for (let index = 0; index < lines.length; index += 1) {
            const match = this.matcher(lines[index] ?? "");
            if (match) {
                starts.push({ lineIndex: index, ...match });
            }
        }
        return dedupeAndSortSymbolRanges(starts
            .map((start, index) => {
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
            .filter((entry) => entry !== null));
    }
}
class PlainTextSymbolParser {
    id = "plain-text";
    extensions = [];
    parse() {
        return [];
    }
}
const SYMBOL_PARSERS = [
    new TypeScriptSymbolParser(),
    new LineBasedSymbolParser({
        id: "python-line",
        extensions: [".py"],
        matcher: (line) => {
            const symbolName = matchFirstGroup(line, /^\s*(?:async\s+def|def)\s+([A-Za-z_]\w*)\b/);
            if (symbolName)
                return { symbolName, kind: "function" };
            const className = matchFirstGroup(line, /^\s*class\s+([A-Za-z_]\w*)\b/);
            return className ? { symbolName: className, kind: "class" } : null;
        }
    }),
    new LineBasedSymbolParser({
        id: "go-line",
        extensions: [".go"],
        matcher: (line) => {
            const functionName = matchFirstGroup(line, /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/);
            if (functionName)
                return { symbolName: functionName, kind: "function" };
            const typeName = matchFirstGroup(line, /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/);
            return typeName ? { symbolName: typeName, kind: "type" } : null;
        }
    }),
    new LineBasedSymbolParser({
        id: "rust-line",
        extensions: [".rs"],
        matcher: (line) => {
            const symbolName = matchFirstGroup(line, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\b/) ??
                matchFirstGroup(line, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)\b/) ??
                matchFirstGroup(line, /^\s*(?:pub(?:\([^)]*\))?\s+)?impl(?:<[^>]+>)?\s+([A-Za-z_]\w*)\b/);
            return symbolName ? { symbolName, kind: "symbol" } : null;
        }
    }),
    new LineBasedSymbolParser({
        id: "java-line",
        extensions: [".java"],
        matcher: (line) => {
            const className = matchFirstGroup(line, /^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b/);
            if (className)
                return { symbolName: className, kind: "type" };
            const methodName = matchFirstGroup(line, /^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)+[A-Za-z_<>, ?]+\s+([A-Za-z_]\w*)\s*\(/);
            return methodName ? { symbolName: methodName, kind: "function" } : null;
        }
    }),
    new LineBasedSymbolParser({
        id: "kotlin-line",
        extensions: [".kt"],
        matcher: (line) => {
            const className = matchFirstGroup(line, /^\s*(?:public|private|protected|internal|data|sealed|open|abstract|final|\s)*\s*(?:class|interface|object|enum\s+class)\s+([A-Za-z_]\w*)\b/);
            if (className)
                return { symbolName: className, kind: "type" };
            const functionName = matchFirstGroup(line, /^\s*(?:public|private|protected|internal|suspend|inline|operator|override|\s)*\s*fun\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*\(/);
            return functionName ? { symbolName: functionName, kind: "function" } : null;
        }
    }),
    new LineBasedSymbolParser({
        id: "swift-line",
        extensions: [".swift"],
        matcher: (line) => {
            const className = matchFirstGroup(line, /^\s*(?:public|private|fileprivate|internal|open|final|\s)*\s*(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)\b/);
            if (className)
                return { symbolName: className, kind: "type" };
            const functionName = matchFirstGroup(line, /^\s*(?:public|private|fileprivate|internal|open|static|class|mutating|\s)*\s*func\s+([A-Za-z_]\w*)\s*\(/);
            return functionName ? { symbolName: functionName, kind: "function" } : null;
        }
    })
];
const PLAIN_TEXT_PARSER = new PlainTextSymbolParser();
const TREE_SITTER_LANGUAGE_BY_EXTENSION = {
    ".py": "python",
    ".go": "go",
    ".rs": "rust"
};
class TreeSitterSymbolParser {
    id = "tree-sitter";
    extensions = [".py", ".go", ".rs"];
    async parse(relativePath, content, options = {}) {
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
        }
        catch (error) {
            options.logger?.warn(`Tree-sitter parser failed for ${relativePath}; falling back to line-based parsing: ${error.message}`);
            return [];
        }
    }
}
const TREE_SITTER_PARSER = new TreeSitterSymbolParser();
export function getSymbolParserForPath(relativePath) {
    const extension = path.extname(relativePath).toLowerCase();
    return SYMBOL_PARSERS.find((parser) => parser.extensions.includes(extension)) ?? PLAIN_TEXT_PARSER;
}
export async function detectSymbolRanges(relativePath, content, options = {}) {
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
    }
    catch (error) {
        options.logger?.warn(`Symbol parser failed for ${relativePath}; falling back to fixed chunking: ${error.message}`);
        return [];
    }
}
function shouldTryTreeSitter(relativePath, mode, config) {
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
function normalizeParserMode(value) {
    return value === "typescript-only" || value === "line-based" || value === "tree-sitter" ? value : "auto";
}
async function importOptionalModule(moduleName) {
    try {
        return (await import(moduleName));
    }
    catch {
        return null;
    }
}
function resolveTreeSitterGrammarPackage(language) {
    return `tree-sitter-${language}`;
}
function getDefaultExport(moduleValue) {
    return moduleValue.default ?? moduleValue;
}
function getTreeSitterGrammarExport(moduleValue, language) {
    return moduleValue.default ?? moduleValue[language] ?? moduleValue;
}
function extractTreeSitterRanges(rootNode, content, language) {
    const ranges = [];
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
function visitTreeSitterNode(node, visitor) {
    if (!node) {
        return;
    }
    visitor(node);
    const childCount = Number(node.namedChildCount ?? node.childCount ?? 0);
    for (let index = 0; index < childCount; index += 1) {
        visitTreeSitterNode(node.namedChild?.(index) ?? node.child?.(index), visitor);
    }
}
function classifyTreeSitterNode(type, language) {
    const nodeType = String(type || "");
    if (language === "python") {
        if (nodeType === "function_definition")
            return "function";
        if (nodeType === "class_definition")
            return "class";
    }
    if (language === "go") {
        if (nodeType === "function_declaration" || nodeType === "method_declaration")
            return "function";
        if (nodeType === "type_declaration")
            return "type";
    }
    if (language === "rust") {
        if (nodeType === "function_item")
            return "function";
        if (nodeType === "struct_item" || nodeType === "enum_item" || nodeType === "trait_item" || nodeType === "impl_item") {
            return "type";
        }
    }
    return null;
}
function extractTreeSitterSymbolName(node) {
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
function extractTopLevelSymbolRanges(sourceFile, content) {
    const ranges = [];
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
function extractStatementSymbolNodes(statement) {
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
    const results = [];
    for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            continue;
        }
        const symbolName = declaration.name.text;
        const initializer = declaration.initializer;
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
            results.push({ node: declaration, symbolName, kind: "function" });
        }
        else if (ts.isClassExpression(initializer)) {
            results.push({ node: declaration, symbolName, kind: "class" });
        }
        else if (ts.isObjectLiteralExpression(initializer)) {
            results.push({ node: declaration, symbolName, kind: "object" });
        }
    }
    return results;
}
function buildSymbolRange(node, symbolName, kind, sourceFile, content) {
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
function dedupeAndSortSymbolRanges(ranges) {
    const seen = new Set();
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
function matchFirstGroup(line, pattern) {
    return pattern.exec(line)?.[1] ?? null;
}
function resolveScriptKind(extension) {
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
