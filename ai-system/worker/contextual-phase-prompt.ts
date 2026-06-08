import { renderWorkerContextPackMarkdown, type WorkerContextPack } from "./context-pack.js";

export function buildImplementationPromptWithContext(input: {
  phasePrompt: string;
  contextPack: WorkerContextPack | null;
}): string {
  if (!input.contextPack) {
    return [
      input.phasePrompt,
      "",
      "Context Pack status: unavailable.",
      "Continue carefully, keep the change set narrow, and explain any additional repository exploration in the final summary."
    ].join("\n");
  }

  return [
    input.phasePrompt,
    "",
    "Use the Context Pack below as the source of truth for this implementation phase.",
    "",
    "Context Pack rules:",
    "- Prefer editing files listed under Relevant Files.",
    "- Do not touch paths listed under Do Not Touch.",
    "- Keep changes inside Allowed Diff Boundary unless impossible.",
    "- If a new file is needed but not listed as proposed, explain why in the final summary.",
    "- If you inspect files outside Relevant Files, mention why in the final summary.",
    "- Follow the listed conventions where they apply.",
    "",
    renderWorkerContextPackMarkdown(input.contextPack)
  ].join("\n");
}
