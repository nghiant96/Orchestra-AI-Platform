import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

/**
 * Write a file through a temp file and a rename, so readers never observe a
 * partially written document.
 *
 * The temp path must be unique per call. Deriving it from a clock is not enough:
 * `Date.now()` has millisecond resolution and concurrent writers to the same
 * record — a heartbeat timer and an inline status update, say — routinely land
 * in the same millisecond. Both then write the same temp file, the first rename
 * consumes it, and the second fails with ENOENT having silently dropped its
 * update. A pid plus a UUID cannot collide across either threads or processes.
 *
 * A failed write removes its own temp file, so a crash mid-write does not leave
 * orphans behind for directory cleanup to trip over.
 */
export async function writeFileAtomic(targetPath: string, contents: string): Promise<void> {
  const tempPath = `${targetPath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}
