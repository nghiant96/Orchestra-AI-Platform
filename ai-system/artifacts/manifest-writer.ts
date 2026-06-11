import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_PATHS } from "./artifact-paths.js";
import type {
  ArtifactStatus,
  CreateJobArtifactInput,
  JobArtifactManifest,
  JobArtifactRefs,
  JobArtifactSummaryData
} from "./artifact-schema.js";

export function createInitialManifest(input: CreateJobArtifactInput): JobArtifactManifest {
  return omitUndefined({
    version: 1,
    jobId: input.jobId,
    mode: input.mode,
    executionMode: input.executionMode,
    status: "created",
    task: omitUndefined({
      title: input.task.title,
      prompt: input.task.prompt,
      createdAt: input.task.createdAt ?? new Date().toISOString()
    }),
    repo: omitUndefined({
      root: input.repo.root,
      gitCommitBefore: input.repo.gitCommitBefore ?? "",
      gitCommitAfter: input.repo.gitCommitAfter,
      branch: input.repo.branch,
      worktreePath: input.repo.worktreePath
    }),
    provider: omitUndefined({
      id: input.provider.id,
      command: input.provider.command
    }),
    artifacts: {}
  }) as JobArtifactManifest;
}

export async function writeInitialManifest(artifactRoot: string, input: CreateJobArtifactInput): Promise<JobArtifactManifest> {
  const manifest = createInitialManifest(input);
  await writeManifest(artifactRoot, manifest);
  return manifest;
}

export async function updateManifestStatus(
  artifactRoot: string,
  status: ArtifactStatus
): Promise<JobArtifactManifest> {
  const manifest = await readManifestFromRoot(artifactRoot);
  manifest.status = status;
  await writeManifest(artifactRoot, manifest);
  return manifest;
}

export async function updateManifestArtifactRefs(
  artifactRoot: string,
  artifacts: Partial<JobArtifactRefs>
): Promise<JobArtifactManifest> {
  const manifest = await readManifestFromRoot(artifactRoot);
  manifest.artifacts = omitUndefined({ ...manifest.artifacts, ...artifacts }) as JobArtifactRefs;
  await writeManifest(artifactRoot, manifest);
  return manifest;
}

export async function updateManifestSummary(
  artifactRoot: string,
  summary: JobArtifactSummaryData
): Promise<JobArtifactManifest> {
  const manifest = await readManifestFromRoot(artifactRoot);
  manifest.summary = summary;
  await writeManifest(artifactRoot, manifest);
  return manifest;
}

export async function readManifestFromRoot(artifactRoot: string): Promise<JobArtifactManifest> {
  const raw = await fs.readFile(path.join(artifactRoot, ARTIFACT_PATHS.manifest), "utf8");
  return JSON.parse(raw) as JobArtifactManifest;
}

export async function writeManifest(artifactRoot: string, manifest: JobArtifactManifest): Promise<void> {
  await fs.mkdir(artifactRoot, { recursive: true });
  await fs.writeFile(
    path.join(artifactRoot, ARTIFACT_PATHS.manifest),
    `${JSON.stringify(omitUndefined(manifest), null, 2)}\n`,
    "utf8"
  );
}

function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => omitUndefined(entry)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      output[key] = omitUndefined(entry);
    }
  }
  return output as T;
}
