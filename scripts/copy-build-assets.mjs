#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const distRoot = path.join(root, "dist");

await fs.mkdir(distRoot, { recursive: true });
await copyFile("package.json", path.join(distRoot, "package.json"));
await copyDirectory("ai-system/config", path.join(distRoot, "ai-system/config"));
await copyDirectory("ai-system/prompts", path.join(distRoot, "ai-system/prompts"));

async function copyFile(relativeSource, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(root, relativeSource), destination);
}

async function copyDirectory(relativeSource, destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(path.join(root, relativeSource), { withFileTypes: true })) {
    const sourcePath = path.join(root, relativeSource, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(path.join(relativeSource, entry.name), destinationPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}
