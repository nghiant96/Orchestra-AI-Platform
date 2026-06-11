import type { SoloRunResult } from "../../solo/solo-runner.js";

export function printSoloResult(result: SoloRunResult): void {
  console.log("");
  console.log("Solo Job");
  console.log(`- success: ${result.ok}`);
  console.log(`- job: ${result.jobId}`);
  console.log(`- summary: ${result.summary}`);
  console.log(`- changed files: ${result.changedFiles.join(", ") || "(none)"}`);
  console.log(`- guards: ${result.guardStatus}`);
  console.log(`- verification: ${result.verificationStatus}`);
  console.log(`- artifacts: ${result.artifactRoot}`);
}
