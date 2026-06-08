import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/api.js";

export interface RepoConventionScanResult {
  screenPatterns: PatternStat[];
  componentPatterns: PatternStat[];
  hookPatterns: PatternStat[];
  servicePatterns: PatternStat[];
  apiClientPatterns: PatternStat[];
  testPatterns: PatternStat[];
}

export interface PatternStat {
  pattern: string;
  count: number;
  confidence: number;
  examples: string[];
}

export async function scanRepoConventions(repoRoot: string): Promise<RepoConventionScanResult> {
  const files = await collectTrackedFiles(repoRoot);
  return {
    screenPatterns: patternStats(files, [
      { pattern: "*Screen.tsx", test: /Screen\.tsx$/ },
      { pattern: "*Screen.ts", test: /Screen\.ts$/ },
      { pattern: "screens/**/*.tsx", test: /(^|\/)screens\/.+\.tsx$/ }
    ]),
    componentPatterns: patternStats(files, [
      { pattern: "components/**/*.tsx", test: /(^|\/)components\/.+\.tsx$/ },
      { pattern: "*.tsx", test: /^[^/]+\.tsx$/ }
    ]),
    hookPatterns: patternStats(files, [
      { pattern: "use*.ts", test: /(^|\/)use[A-Z][^/]*\.ts$/ },
      { pattern: "use*.tsx", test: /(^|\/)use[A-Z][^/]*\.tsx$/ },
      { pattern: "hooks/use*.ts", test: /(^|\/)hooks\/use[A-Z][^/]*\.ts$/ }
    ]),
    servicePatterns: patternStats(files, [
      { pattern: "*Service.ts", test: /Service\.ts$/ },
      { pattern: "services/**/*.ts", test: /(^|\/)services\/.+\.ts$/ }
    ]),
    apiClientPatterns: patternStats(files, [
      { pattern: "*Api.ts", test: /Api\.ts$/ },
      { pattern: "*API.ts", test: /API\.ts$/ },
      { pattern: "api/**/*.ts", test: /(^|\/)api\/.+\.ts$/ }
    ]),
    testPatterns: patternStats(files, [
      { pattern: "*.test.ts", test: /\.test\.ts$/ },
      { pattern: "*.test.tsx", test: /\.test\.tsx$/ },
      { pattern: "*.spec.ts", test: /\.spec\.ts$/ },
      { pattern: "*.spec.tsx", test: /\.spec\.tsx$/ }
    ])
  };
}

export async function writeRepoConventionScanArtifact(
  artifactDir: string,
  result: RepoConventionScanResult
): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "repo-conventions.json"),
    `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
    "utf8"
  );
}

async function collectTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const result = await runCommand({
      command: "git",
      args: ["ls-files"],
      cwd: repoRoot,
      timeoutMs: 30000
    });
    return result.stdout
      .split(/\r?\n/)
      .map((filePath) => filePath.trim().replace(/\\/g, "/"))
      .filter(Boolean)
      .filter((filePath) => !isIgnored(filePath));
  } catch {
    return [];
  }
}

function patternStats(
  files: string[],
  patterns: Array<{ pattern: string; test: RegExp }>
): PatternStat[] {
  return patterns
    .map(({ pattern, test }) => {
      const matches = files.filter((filePath) => test.test(filePath));
      return {
        pattern,
        count: matches.length,
        confidence: files.length === 0 ? 0 : Math.min(1, matches.length / Math.max(1, Math.min(files.length, 20))),
        examples: matches.slice(0, 5)
      };
    })
    .filter((stat) => stat.count > 0)
    .sort((left, right) => right.count - left.count || left.pattern.localeCompare(right.pattern));
}

function isIgnored(filePath: string): boolean {
  return /(^|\/)(node_modules|dist|build|coverage|Pods|\.ai-system-artifacts|\.ai-system-memory|\.ai-system-vector|\.orchestra)(\/|$)/.test(filePath);
}
