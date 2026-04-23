import fs from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "../utils/string.js";

export interface DependencyNode {
  path: string;
  imports: string[];
  importedBy: string[];
}

export class DependencyGraph {
  nodes: Map<string, DependencyNode> = new Map();
  repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  async buildGraph(entryFiles: string[]): Promise<void> {
    const queue = [...entryFiles];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const relativePath = queue.shift()!;
      if (visited.has(relativePath)) {
        continue;
      }
      visited.add(relativePath);

      const node = await this.getOrAddNode(relativePath);
      const imports = await this.parseImports(relativePath);

      for (const importPath of imports) {
        const resolved = await this.resolveImport(relativePath, importPath);
        if (resolved) {
          node.imports.push(resolved);
          const targetNode = await this.getOrAddNode(resolved);
          targetNode.importedBy.push(relativePath);
          
          if (!visited.has(resolved)) {
            queue.push(resolved);
          }
        }
      }
    }
  }

  async getRelatedFiles(entryFiles: string[], maxDepth = 1): Promise<string[]> {
    const related = new Set<string>(entryFiles);
    const queue = entryFiles.map(file => ({ file, depth: 0 }));

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;
      if (depth >= maxDepth) {
        continue;
      }

      const node = this.nodes.get(file);
      if (!node) continue;

      const connections = [...node.imports, ...node.importedBy];
      for (const connected of connections) {
        if (!related.has(connected)) {
          related.add(connected);
          queue.push({ file: connected, depth: depth + 1 });
        }
      }
    }

    return [...related];
  }

  getConnections(file: string): string[] {
    const node = this.nodes.get(file);
    if (!node) {
      return [];
    }
    return [...new Set([...node.imports, ...node.importedBy])];
  }

  private async getOrAddNode(relativePath: string): Promise<DependencyNode> {
    let node = this.nodes.get(relativePath);
    if (!node) {
      node = { path: relativePath, imports: [], importedBy: [] };
      this.nodes.set(relativePath, node);
    }
    return node;
  }

  private async parseImports(relativePath: string): Promise<string[]> {
    const absolutePath = path.resolve(this.repoRoot, relativePath);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      const imports: string[] = [];

      // Basic regex for ESM imports and CommonJS requires
      const importRegex = /import\s+.*?\s+from\s+['"](.*?)['"]/g;
      const dynamicImportRegex = /import\(['"](.*?)['"]\)/g;
      const requireRegex = /require\(['"](.*?)['"]\)/g;
      const exportRegex = /export\s+.*?\s+from\s+['"](.*?)['"]/g;

      let match;
      while ((match = importRegex.exec(content)) !== null) imports.push(match[1]);
      while ((match = dynamicImportRegex.exec(content)) !== null) imports.push(match[1]);
      while ((match = requireRegex.exec(content)) !== null) imports.push(match[1]);
      while ((match = exportRegex.exec(content)) !== null) imports.push(match[1]);

      return imports.filter(p => p.startsWith(".")); // Only track relative internal imports
    } catch {
      return [];
    }
  }

  private async resolveImport(sourceFile: string, importPath: string): Promise<string | null> {
    const sourceDir = path.dirname(path.resolve(this.repoRoot, sourceFile));
    const targetBase = path.resolve(sourceDir, importPath);
    
    const candidates = [
      targetBase,
      targetBase + ".ts",
      targetBase + ".tsx",
      targetBase + ".js",
      targetBase + ".jsx",
      path.join(targetBase, "index.ts"),
      path.join(targetBase, "index.tsx"),
      path.join(targetBase, "index.js"),
    ];

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          return toPosixPath(path.relative(this.repoRoot, candidate));
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
