import { filterExistingSafeReadFiles } from "./context.js";
import { DependencyGraph } from "./dependency-graph.js";
import { VectorIndex } from "./vector-index.js";
import type { Logger, RulesConfig, VectorSearchMatch } from "../types.js";

export interface ContextExpansionResult {
  readFiles: string[];
  dependencyFiles: string[];
  vectorMatches: VectorSearchMatch[];
}

export async function expandContextReadFiles({
  repoRoot,
  rules,
  task,
  prompt,
  initialReadFiles,
  writeTargets,
  logger
}: {
  repoRoot: string;
  rules: RulesConfig;
  task: string;
  prompt?: string;
  initialReadFiles: string[];
  writeTargets?: string[];
  logger?: Logger;
}): Promise<ContextExpansionResult> {
  let dependencyFiles = [...initialReadFiles];
  if (initialReadFiles.length > 0) {
    const graph = new DependencyGraph(repoRoot);
    await graph.buildGraph(initialReadFiles);
    dependencyFiles = await graph.getRelatedFiles(initialReadFiles, 1);
  }

  let vectorMatches: VectorSearchMatch[] = [];
  if (rules.vector_search?.enabled) {
    const vectorIndex = new VectorIndex({
      repoRoot,
      rules,
      config: rules.vector_search,
      logger
    });
    const indexed = await vectorIndex.indexWorkspace();
    logger?.info(`Indexed ${indexed.fileCount} file(s) into ${indexed.chunkCount} semantic chunk(s).`);
    vectorMatches = await vectorIndex.search(
      [task, prompt, ...(initialReadFiles ?? []), ...(writeTargets ?? [])].filter(Boolean).join("\n"),
      rules.vector_search?.max_results
    );
  }

  const mergedReadFiles = await filterExistingSafeReadFiles(
    repoRoot,
    [...dependencyFiles, ...vectorMatches.map((match) => match.path)],
    rules,
    logger
  );

  return {
    readFiles: mergedReadFiles,
    dependencyFiles,
    vectorMatches
  };
}
