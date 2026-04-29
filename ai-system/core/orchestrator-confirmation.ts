import readline from "node:readline/promises";
import type { Logger, PlanResult } from "../types.js";

export async function confirmPlan(plan: PlanResult, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;

  console.log("\n--- Proposed Plan ---");
  console.log(`Prompt: ${plan.prompt}`);
  console.log(`Files to read:   ${plan.readFiles.length > 0 ? plan.readFiles.join(", ") : "(none)"}`);
  console.log(`Files to write:  ${plan.writeTargets.length > 0 ? plan.writeTargets.join(", ") : "(none)"}`);
  if (plan.notes.length > 0) {
    console.log("Notes:");
    plan.notes.forEach((note) => console.log(`  - ${note}`));
  }
  console.log("---------------------\n");

  if (!process.stdin.isTTY) return true;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const abortHandler = () => rl.close();
  signal?.addEventListener('abort', abortHandler);

  try {
    const answer = await rl.question("Proceed with this plan? (y/n): ");
    return answer.toLowerCase().startsWith("y");
  } catch (err) {
    if (signal?.aborted) return false;
    throw err;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    rl.close();
  }
}

export async function confirmCheckpoint({
  message,
  artifactPath,
  logger,
  signal
}: {
  message: string;
  artifactPath?: string | null;
  logger: Logger;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (signal?.aborted) return false;

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

  const abortHandler = () => rl.close();
  signal?.addEventListener('abort', abortHandler);

  try {
    const answer = await rl.question("Continue? (y/n): ");
    return answer.toLowerCase().startsWith("y");
  } catch (err) {
    if (signal?.aborted) return false;
    throw err;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    rl.close();
  }
}
