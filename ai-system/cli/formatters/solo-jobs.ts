import type { JobArtifactSummary } from "../../artifacts/artifact-schema.js";
import type {
  SoloCommitResult,
  SoloContinueResult,
  SoloDiffExplainResult,
  SoloJobLogsResult,
  SoloJobShowResult,
  SoloUndoResult
} from "../../solo/solo-jobs.js";

export function printSoloJobList(jobs: JobArtifactSummary[]): void {
  console.log("");
  console.log("Solo Jobs");
  if (jobs.length === 0) {
    console.log("- (none)");
    return;
  }
  for (const job of jobs) {
    console.log(`- ${job.jobId}: ${job.status} ${job.executionMode} changed=${job.changedFileCount ?? 0} created=${job.createdAt}`);
    console.log(`  ${job.taskPrompt}`);
  }
}

export function printSoloJobShow(result: SoloJobShowResult): void {
  console.log("");
  console.log("Solo Job");
  console.log(`- job: ${result.manifest.jobId}`);
  console.log(`- status: ${result.manifest.status}`);
  console.log(`- mode: ${result.manifest.executionMode}`);
  console.log(`- created: ${result.manifest.task.createdAt}`);
  console.log(`- task: ${result.manifest.task.prompt}`);
  console.log(`- changed files: ${result.changedFiles.join(", ") || "(none)"}`);
  console.log(`- artifacts: ${result.artifactRoot}`);
  if (result.diffStat.trim()) {
    console.log("- diff stat:");
    console.log(indent(result.diffStat.trim()));
  }
}

export function printSoloJobLogs(result: SoloJobLogsResult): void {
  console.log("");
  console.log("Solo Job Logs");
  console.log(`- artifacts: ${result.artifactRoot}`);
  console.log("");
  console.log("stdout");
  console.log(result.stdout.trim() || "(empty)");
  console.log("");
  console.log("stderr");
  console.log(result.stderr.trim() || "(empty)");
}

export function printSoloDiffExplain(result: SoloDiffExplainResult): void {
  console.log("");
  console.log("Solo Diff");
  console.log(`- artifacts: ${result.artifactRoot}`);
  console.log("- files:");
  console.log(indent(result.summary));
  if (result.diffStat.trim()) {
    console.log("- diff stat:");
    console.log(indent(result.diffStat.trim()));
  }
}

export function printSoloUndoResult(result: SoloUndoResult): void {
  console.log("");
  console.log("Solo Undo");
  console.log(`- success: ${result.ok}`);
  console.log(`- job: ${result.jobId}`);
  console.log(`- summary: ${result.summary}`);
  console.log(`- artifacts: ${result.artifactRoot}`);
}

export function printSoloContinueResult(result: SoloContinueResult): void {
  console.log("");
  console.log("Solo Continue");
  console.log(`- source job: ${result.sourceJobId}`);
  console.log(`- new job: ${result.run.jobId}`);
  console.log(`- success: ${result.run.ok}`);
  console.log(`- summary: ${result.run.summary}`);
  console.log(`- artifacts: ${result.run.artifactRoot}`);
}

export function printSoloCommitResult(result: SoloCommitResult): void {
  console.log("");
  console.log("Solo Commit");
  console.log(`- success: ${result.ok}`);
  console.log(`- job: ${result.jobId}`);
  console.log(`- commit: ${result.commitSha || "(none)"}`);
  console.log(`- files: ${result.changedFiles.join(", ") || "(none)"}`);
  console.log(`- summary: ${result.summary}`);
  console.log(`- artifacts: ${result.artifactRoot}`);
  if (result.message.trim()) {
    console.log("- message:");
    console.log(indent(result.message.trim()));
  }
}

function indent(value: string): string {
  return value.split(/\r?\n/).map((line) => `  ${line}`).join("\n");
}
