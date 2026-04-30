import { DependencyGraph } from "./dependency-graph.js";
import type { RefactorAnalysis, RefactorBatch } from "../types.js";

/**
 * Performs a read-only refactor analysis on a set of files.
 */
export async function performRefactorAnalysis({
  repoRoot: _repoRoot,
  goal,
  changedFiles,
  dependencyGraph
}: {
  repoRoot: string;
  goal: string;
  changedFiles: string[];
  dependencyGraph: DependencyGraph;
}): Promise<RefactorAnalysis> {
  const affectedFilesSet = new Set<string>(changedFiles);
  
  // Identify direct impact
  const directConnections = await dependencyGraph.getRelatedFiles(changedFiles, 1);
  for (const file of directConnections) {
    affectedFilesSet.add(file);
  }

  const affectedFiles = [...affectedFilesSet].sort();

  // Build dependency clusters (connected components)
  const dependencyClusters = buildDependencyClusters(affectedFiles, dependencyGraph);

  // Identify risk areas
  const riskAreas = identifyRiskAreas(changedFiles, dependencyGraph);

  // Propose batches
  const proposedBatches = proposeRefactorBatches(dependencyClusters, goal);

  return {
    goal,
    affectedFiles,
    dependencyClusters,
    riskAreas,
    testsToRun: identifyRelatedTests(affectedFiles),
    proposedBatches
  };
}

function buildDependencyClusters(files: string[], graph: DependencyGraph): string[][] {
  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const file of files) {
    if (!visited.has(file)) {
      const cluster: string[] = [];
      const queue = [file];
      visited.add(file);

      while (queue.length > 0) {
        const current = queue.shift()!;
        cluster.push(current);

        const connections = graph.getConnections(current);
        for (const conn of connections) {
          if (files.includes(conn) && !visited.has(conn)) {
            visited.add(conn);
            queue.push(conn);
          }
        }
      }
      clusters.push(cluster.sort());
    }
  }

  return clusters.sort((a, b) => b.length - a.length);
}

function identifyRiskAreas(changedFiles: string[], graph: DependencyGraph): Array<{ file: string; reason: string }> {
  const riskAreas: Array<{ file: string; reason: string }> = [];

  for (const file of changedFiles) {
    const node = graph.nodes.get(file);
    if (node && node.importedBy.length > 5) {
      riskAreas.push({
        file,
        reason: `Highly coupled: imported by ${node.importedBy.length} files.`
      });
    }

    if (file.includes("types") || file.includes("schema") || file.endsWith(".d.ts")) {
      riskAreas.push({
        file,
        reason: "Core type/schema change: high downstream impact risk."
      });
    }
  }

  return riskAreas;
}

function proposeRefactorBatches(clusters: string[][], _goal: string): RefactorBatch[] {
  const batches: RefactorBatch[] = [];
  let batchCount = 0;

  for (const cluster of clusters) {
    // If cluster is small, keep it as one batch
    if (cluster.length <= 3) {
      batchCount++;
      batches.push(createBatch(batchCount, cluster));
      continue;
    }

    // Split larger clusters by directory (module boundary)
    const byDir = new Map<string, string[]>();
    for (const file of cluster) {
      const dir = file.includes("/") ? file.split("/")[0] : "root";
      const files = byDir.get(dir) ?? [];
      files.push(file);
      byDir.set(dir, files);
    }

    for (const [dir, files] of byDir.entries()) {
      // Further split if directory group is too large
      const maxFilesPerBatch = 5;
      for (let i = 0; i < files.length; i += maxFilesPerBatch) {
        const chunk = files.slice(i, i + maxFilesPerBatch);
        batchCount++;
        batches.push(createBatch(batchCount, chunk, dir !== "root" ? `module: ${dir}` : undefined));
      }
    }
  }

  return batches;
}

function createBatch(index: number, files: string[], moduleName?: string): RefactorBatch {
  const isLarge = files.length > 3;
  const testFiles = identifyRelatedTests(files);
  const verificationCmd = testFiles.length > 0 
    ? `pnpm test ${testFiles.join(" ")}` 
    : "pnpm run typecheck && pnpm run lint";

  return {
    id: `batch-${index}`,
    goal: `Refactor subgroup: ${moduleName ? moduleName + " - " : ""}${files[0]} and related files`,
    files: files.sort(),
    rationale: `This batch contains ${files.length} related files${moduleName ? " in " + moduleName : ""}.`,
    verification: `${verificationCmd} (Verify direct importers and core logic)`,
    rollback: `git checkout HEAD -- ${files.join(" ")}`,
    type: isLarge ? "behavioral" : "mechanical"
  };
}

function identifyRelatedTests(files: string[]): string[] {
  const tests = new Set<string>();
  for (const file of files) {
    if (file.includes("test") || file.includes("spec")) {
      tests.add(file);
    } else {
      // Convention based test finding could go here
      const parts = file.split(".");
      const ext = parts.pop();
      if (ext) {
        tests.add(parts.join(".") + ".test." + ext);
      }
    }
  }
  return [...tests].sort();
}
