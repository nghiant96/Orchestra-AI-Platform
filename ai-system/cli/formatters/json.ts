import path from "node:path";
import fs from "node:fs/promises";
import { formatDisplayJson } from "./shared.js";

export function printJson(value: unknown): void {
  console.log(formatDisplayJson(value));
}

export async function outputJsonResult(value: unknown, savePath: string | null): Promise<void> {
  const serialized = formatDisplayJson(value);
  if (savePath) {
    const absolutePath = path.resolve(savePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${serialized}\n`, "utf8");
    console.log(`[saved] ${absolutePath}`);
    return;
  }

  console.log(serialized);
}
