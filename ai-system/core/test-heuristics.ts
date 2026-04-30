import type { TestRequirement, ToolExecutionResult } from "../types.js";
import type { BlastRadiusContext } from "./blast-radius.js";

/**
 * Detects missing tests based on the current change context and tool results.
 */
export function detectMissingTests({
  changedFiles,
  blastRadius,
  toolResults
}: {
  changedFiles: string[];
  blastRadius: BlastRadiusContext;
  toolResults: ToolExecutionResult[];
}): TestRequirement[] {
  const missingTests: TestRequirement[] = [];

  // 1. Identify which related tests are already "covered" by tool results
  for (const result of toolResults) {
    if (result.name === "test" && result.ok) {
      // In a real system, we'd check which specific tests ran
      // For now, if 'test' tool passed, we assume some coverage happened
    }
  }

  // 2. Check for server/queue changes
  const hasServerChanges = changedFiles.some(f => /(server-app|job-queue|orchestrator)/i.test(f));
  if (hasServerChanges) {
    const serverTest = "tests/server-queue.test.ts";
    if (!isTestCovered(serverTest, toolResults)) {
      missingTests.push({
        name: "Server/Queue Integration",
        description: "Critical server or queue logic changed. Ensure integration tests cover the new behavior.",
        severity: "required",
        status: "not_run",
        targetPath: serverTest,
        command: `pnpm exec node --import tsx --test ${serverTest}`
      });
    }
  }

  // 3. Check for dashboard changes
  const hasDashboardChanges = changedFiles.some(f => f.startsWith("dashboard/src/"));
  if (hasDashboardChanges) {
    if (!isTestCovered("dashboard-test", toolResults)) {
      missingTests.push({
        name: "Dashboard Unit Tests",
        description: "Dashboard components changed. Run dashboard unit tests to prevent UI regressions.",
        severity: "required",
        status: "not_run",
        command: "pnpm --dir dashboard test"
      });
    }
  }

  // 4. Check for artifact/schema changes
  const hasSchemaChanges = changedFiles.some(f => /(types\.ts|artifacts\.ts)/i.test(f));
  if (hasSchemaChanges) {
    const artifactTest = "tests/artifacts.test.ts";
    if (!isTestCovered(artifactTest, toolResults)) {
      missingTests.push({
        name: "Artifact Backward Compatibility",
        description: "Types or artifact persistence changed. Verify that old artifacts still load correctly.",
        severity: "required",
        status: "not_run",
        targetPath: artifactTest,
        command: `pnpm exec node --import tsx --test ${artifactTest}`
      });
    }
  }

  // 5. Suggest tests for each changed file by convention
  for (const testFile of blastRadius.relatedTests) {
    if (!isTestCovered(testFile, toolResults)) {
      missingTests.push({
        name: `Targeted Test: ${testFile}`,
        description: `Related test file identified by naming convention.`,
        severity: "optional",
        status: "not_run",
        targetPath: testFile,
        command: `pnpm exec node --import tsx --test ${testFile}`
      });
    }
  }

  return missingTests;
}

function isTestCovered(testId: string, toolResults: ToolExecutionResult[]): boolean {
  return toolResults.some(r => {
    if (!r.ok) return false;
    if (r.name === "test") {
      // If a specific test file was targeted
      if (r.args?.includes(testId)) return true;
      // If it was a broad test run that likely included it
      if (r.summary.toLowerCase().includes("passed") && !r.args?.length) return true;
    }
    // Dashboard specific check
    if (testId === "dashboard-test" && r.name === "dashboard:test" && r.ok) return true;
    return false;
  });
}
