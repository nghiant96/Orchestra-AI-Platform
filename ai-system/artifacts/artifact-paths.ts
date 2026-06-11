export const ARTIFACT_PATHS = {
  manifest: "manifest.json",
  task: "task.md",
  phaseState: "phase-state.json",

  contextPack: "context/context-pack.json",
  contextPackMarkdown: "context/context-pack.md",
  preContextPack: "context/pre-context-pack.json",
  preContextPackMarkdown: "context/pre-context-pack.md",
  repoConventions: "context/repo-conventions.json",

  providerStdout: "provider/provider-stdout.log",
  providerStderr: "provider/provider-stderr.log",
  process: "provider/process.json",

  diffPatch: "diff/diff.patch",
  diffStat: "diff/diff-stat.txt",
  changedFiles: "diff/changed-files.json",

  diffBoundaryCheck: "guards/diff-boundary-check.json",
  namingCheck: "guards/naming-check.json",

  verification: "verification/verification.json",
  checksDir: "verification/checks",
  phasesDir: "phases"
} as const;

export function phaseArtifactPath(phaseId: string): string {
  return `${ARTIFACT_PATHS.phasesDir}/${sanitizeArtifactSegment(phaseId)}.json`;
}

export function checkLogPath(name: string): string {
  return `${ARTIFACT_PATHS.checksDir}/${sanitizeArtifactSegment(name)}.log`;
}

export function checkJsonPath(name: string): string {
  return `${ARTIFACT_PATHS.checksDir}/${sanitizeArtifactSegment(name)}.json`;
}

export function sanitizeArtifactSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "artifact";
}
