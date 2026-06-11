import type {
  ArtifactWriteInput,
  CreateJobArtifactInput,
  JobArtifactManifest,
  JobArtifactRef,
  JobArtifactSummary,
  JobListFilter
} from "./artifact-schema.js";

export interface JobArtifactStore {
  createJob(input: CreateJobArtifactInput): Promise<JobArtifactRef>;
  readManifest(jobId: string): Promise<JobArtifactManifest>;
  writeArtifact(jobId: string, artifact: ArtifactWriteInput): Promise<void>;
  readArtifact(jobId: string, artifactPath: string): Promise<string | Buffer | null>;
  listJobs(filter?: JobListFilter): Promise<JobArtifactSummary[]>;
}
