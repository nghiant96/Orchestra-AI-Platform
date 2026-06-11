import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../utils/api.js";
import { ARTIFACT_PATHS } from "./artifact-paths.js";
import type {
  ArtifactWriteInput,
  CreateJobArtifactInput,
  JobArtifactManifest,
  JobArtifactRef,
  JobArtifactSummary,
  JobListFilter
} from "./artifact-schema.js";
import type { JobArtifactStore } from "./job-artifact-store.js";
import { readManifestFromRoot, writeInitialManifest } from "./manifest-writer.js";

export class LocalArtifactStore implements JobArtifactStore {
  constructor(private readonly rootDir = path.join(process.cwd(), ".orchestra", "jobs")) {}

  async createJob(input: CreateJobArtifactInput): Promise<JobArtifactRef> {
    const artifactRoot = this.jobRoot(input.jobId);
    const gitCommitBefore = input.repo.gitCommitBefore ?? await readGitHead(input.repo.root);
    await fs.mkdir(artifactRoot, { recursive: true });
    await writeInitialManifest(artifactRoot, {
      ...input,
      repo: {
        ...input.repo,
        gitCommitBefore
      }
    });
    await this.writeArtifact(input.jobId, {
      path: ARTIFACT_PATHS.task,
      content: `${input.task.prompt.trim()}\n`
    });
    return {
      jobId: input.jobId,
      artifactRoot,
      manifestPath: path.join(artifactRoot, ARTIFACT_PATHS.manifest)
    };
  }

  async readManifest(jobId: string): Promise<JobArtifactManifest> {
    return readManifestFromRoot(this.jobRoot(jobId));
  }

  async writeArtifact(jobId: string, artifact: ArtifactWriteInput): Promise<void> {
    const targetPath = this.resolveArtifactPath(jobId, artifact.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, artifact.content);
  }

  async readArtifact(jobId: string, artifactPath: string): Promise<string | Buffer | null> {
    try {
      return await fs.readFile(this.resolveArtifactPath(jobId, artifactPath));
    } catch {
      return null;
    }
  }

  async listJobs(filter: JobListFilter = {}): Promise<JobArtifactSummary[]> {
    const entries = await safeReadDir(this.rootDir);
    const jobs: JobArtifactSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const artifactRoot = this.jobRoot(entry.name);
        const manifest = await readManifestFromRoot(artifactRoot);
        if (filter.mode && manifest.mode !== filter.mode) continue;
        if (filter.status && manifest.status !== filter.status) continue;
        jobs.push({
          jobId: manifest.jobId,
          status: manifest.status,
          mode: manifest.mode,
          executionMode: manifest.executionMode,
          taskTitle: manifest.task.title,
          taskPrompt: manifest.task.prompt,
          createdAt: manifest.task.createdAt,
          artifactRoot,
          changedFileCount: manifest.summary?.changedFileCount,
          guardStatus: manifest.summary?.guardStatus,
          verificationStatus: manifest.summary?.verificationStatus
        });
      } catch {
        continue;
      }
    }
    const sorted = jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return typeof filter.limit === "number" ? sorted.slice(0, filter.limit) : sorted;
  }

  private jobRoot(jobId: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(jobId)) {
      throw new Error(`Invalid artifact job id: ${jobId}`);
    }
    return path.join(this.rootDir, jobId);
  }

  private resolveArtifactPath(jobId: string, artifactPath: string): string {
    const normalized = artifactPath.replace(/\\/g, "/");
    if (path.isAbsolute(normalized) || normalized.split("/").includes("..") || normalized.includes("\0")) {
      throw new Error(`Invalid artifact path: ${artifactPath}`);
    }
    const jobRoot = this.jobRoot(jobId);
    const target = path.resolve(jobRoot, normalized);
    const rootWithSeparator = `${path.resolve(jobRoot)}${path.sep}`;
    if (target !== path.resolve(jobRoot) && !target.startsWith(rootWithSeparator)) {
      throw new Error(`Artifact path escapes job root: ${artifactPath}`);
    }
    return target;
  }
}

async function safeReadDir(dir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readGitHead(repoRoot: string): Promise<string> {
  try {
    const result = await runCommand({
      command: "git",
      args: ["rev-parse", "HEAD"],
      cwd: repoRoot,
      timeoutMs: 30000
    });
    return result.stdout.trim();
  } catch {
    return "";
  }
}
