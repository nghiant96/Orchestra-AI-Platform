import {
  createFallbackWorkerContextPack,
  normalizeWorkerContextPack,
  type WorkerContextPack
} from "./context-pack.js";

export function extractContextPackFromProviderResult(
  text: string,
  fallback: { jobId: string; task: string }
): WorkerContextPack | null {
  const jsonText = extractContextPackJson(text);
  if (!jsonText) {
    return null;
  }

  try {
    return normalizeWorkerContextPack(JSON.parse(jsonText), fallback);
  } catch (error) {
    return createFallbackWorkerContextPack({
      ...fallback,
      warning: `Failed to parse ORCHESTRA_CONTEXT_PACK JSON: ${error instanceof Error ? error.message : "unknown error"}`
    });
  }
}

function extractContextPackJson(text: string): string | null {
  const markerMatch = /ORCHESTRA_CONTEXT_PACK\s*:/i.exec(text);
  if (!markerMatch) return null;

  const afterMarker = text.slice(markerMatch.index + markerMatch[0].length);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(afterMarker);
  if (fenced?.[1]?.trim().startsWith("{")) {
    return fenced[1].trim();
  }

  const firstBrace = afterMarker.indexOf("{");
  if (firstBrace < 0) return null;

  return readBalancedJsonObject(afterMarker.slice(firstBrace));
}

function readBalancedJsonObject(text: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(0, index + 1).trim();
      }
    }
  }

  return null;
}
