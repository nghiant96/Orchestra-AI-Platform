import path from "node:path";
import type { InteractiveState } from "./types.js";
import { applyProviderPreset } from "./presets.js";
import { printInteractiveHelp, printSessionStatus } from "./formatters.js";

export async function handleInteractiveCommand(line: string, state: InteractiveState): Promise<"exit" | "handled" | null> {
  if (line === "exit" || line === "quit" || line === "/exit" || line === "/quit") {
    return "exit";
  }

  if (line === "/help") {
    printInteractiveHelp();
    return "handled";
  }

  if (line === "/status") {
    printSessionStatus(state);
    return "handled";
  }

  if (line === "/dry-run" || line === "/dry-run on") {
    state.dryRun = true;
    console.log("[info] dry-run enabled");
    return "handled";
  }

  if (line === "/dry-run off") {
    state.dryRun = false;
    console.log("[info] dry-run disabled");
    return "handled";
  }

  if (line === "/interactive" || line === "/interactive on") {
    state.interactive = true;
    console.log("[info] plan approval enabled");
    return "handled";
  }

  if (line === "/interactive off") {
    state.interactive = false;
    console.log("[info] plan approval disabled");
    return "handled";
  }

  if (line === "/pause-plan" || line === "/pause-plan on") {
    state.pauseAfterPlan = true;
    console.log("[info] pause-after-plan enabled");
    return "handled";
  }

  if (line === "/pause-plan off") {
    state.pauseAfterPlan = false;
    console.log("[info] pause-after-plan disabled");
    return "handled";
  }

  if (line === "/pause-generate" || line === "/pause-generate on") {
    state.pauseAfterGenerate = true;
    console.log("[info] pause-after-generate enabled");
    return "handled";
  }

  if (line === "/pause-generate off") {
    state.pauseAfterGenerate = false;
    console.log("[info] pause-after-generate disabled");
    return "handled";
  }

  if (line === "/manual-review" || line === "/manual-review on") {
    state.interactive = true;
    state.pauseAfterPlan = true;
    state.pauseAfterGenerate = true;
    console.log("[info] manual-review mode enabled");
    return "handled";
  }

  if (line === "/manual-review off") {
    state.pauseAfterPlan = false;
    state.pauseAfterGenerate = false;
    console.log("[info] manual-review mode disabled");
    return "handled";
  }

  if (line.startsWith("/cwd ")) {
    state.cwd = path.resolve(line.slice(5).trim());
    console.log(`[info] cwd set to ${state.cwd}`);
    return "handled";
  }

  if (line === "/config clear") {
    state.configPath = null;
    console.log("[info] config override cleared");
    return "handled";
  }

  if (line.startsWith("/config ")) {
    const value = line.slice(8).trim();
    state.configPath = value ? path.resolve(value) : null;
    console.log(`[info] config set to ${state.configPath ?? "(auto)"}`);
    return "handled";
  }

  if (line === "/provider clear") {
    state.providerPreset = null;
    console.log("[info] provider preset cleared");
    return "handled";
  }

  if (line.startsWith("/provider ")) {
    const value = line.slice(10).trim();
    state.providerPreset = value || null;
    applyProviderPreset(state.providerPreset);
    console.log(`[info] provider preset set to ${state.providerPreset ?? "(default)"}`);
    return "handled";
  }

  if (line === "/resume-last") {
    state.resumeTarget = "last";
    console.log("[info] resume target set to last");
    return "handled";
  }

  if (line.startsWith("/resume ")) {
    const value = line.slice(8).trim();
    state.resumeTarget = value || null;
    console.log(`[info] resume target set to ${state.resumeTarget ?? "(none)"}`);
    return "handled";
  }

  if (line === "/resume clear") {
    state.resumeTarget = null;
    console.log("[info] resume target cleared");
    return "handled";
  }

  return null;
}

export function buildPrompt(state: InteractiveState): string {
  const mode = [
    state.dryRun ? "dry-run" : null,
    state.interactive ? "confirm-plan" : null,
    state.pauseAfterPlan ? "pause-plan" : null,
    state.pauseAfterGenerate ? "pause-generate" : null,
    state.providerPreset ? state.providerPreset : null
  ]
    .filter(Boolean)
    .join(",");
  return `ai:${path.basename(state.cwd)}${mode ? ` [${mode}]` : ""}> `;
}
