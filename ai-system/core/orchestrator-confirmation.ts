import readline from "node:readline/promises";
import type { Logger, PlanResult } from "../types.js";

export async function confirmPlan(plan: PlanResult): Promise<boolean> {
  console.log("\n--- Proposed Plan ---");
  console.log(`Prompt: ${plan.prompt}`);
  console.log(`Files to read:   ${plan.readFiles.length > 0 ? plan.readFiles.join(", ") : "(none)"}`);
  console.log(`Files to write:  ${plan.writeTargets.length > 0 ? plan.writeTargets.join(", ") : "(none)"}`);
  if (plan.notes.length > 0) {
    console.log("Notes:");
    plan.notes.forEach((note) => console.log(`  - ${note}`));
  }
  console.log("---------------------\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question("Proceed with this plan? (y/n): ");
    return answer.toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

export async function confirmCheckpoint({
  message,
  artifactPath,
  logger
}: {
  message: string;
  artifactPath?: string | null;
  logger: Logger;
}): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    logger.info(`Skipping interactive checkpoint prompt because no TTY is available. Artifact: ${artifactPath}`);
    return true;
  }

  console.log("\n--- Checkpoint ---");
  console.log(message);
  if (artifactPath) {
    console.log(`Artifact: ${artifactPath}`);
  }
  console.log("Type 'y' to continue or anything else to stop here.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question("Continue? (y/n): ");
    return answer.toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}
