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

export function buildSetupPromptWithPreContext(input: {
  phasePrompt: string;
  preContextPack: WorkerContextPack | null;
}): string {
  if (!input.preContextPack) {
    return [
      input.phasePrompt,
      "",
      "Pre-context status: unavailable.",
      "Derive the setup output from the repository itself and keep the final ORCHESTRA_CONTEXT_PACK concise."
    ].join("\n");
  }

  return [
    input.phasePrompt,
    "",
    "Use the pre-context below as the draft starting point for the final ORCHESTRA_CONTEXT_PACK.",
    "Refine it with repository evidence, tighten the candidate list, and keep the final context actionable.",
    "",
    "Pre-context rules:",
    "- Treat it as a draft, not as a finished plan.",
    "- Improve the relevance, boundary, and verification details where evidence supports it.",
    "- Keep the final ORCHESTRA_CONTEXT_PACK valid JSON.",
    "",
    renderWorkerContextPackMarkdown(input.preContextPack)
  ].join("\n");
}
