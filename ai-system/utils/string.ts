export function stripMarkdownCodeFences(text: unknown): string {
  if (typeof text !== "string") {
    return "";
  }

  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

export function extractBalancedJson(text: string): string {
  const input = stripMarkdownCodeFences(text);
  const startIndexes: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "{" || char === "[") {
      startIndexes.push(index);
    }
  }

  for (const start of startIndexes) {
    const candidate = sliceBalancedJson(input, start);
    if (candidate) {
      return candidate;
    }
  }

  return input.trim();
}

function sliceBalancedJson(text: string, startIndex: number): string | null {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

export function parseJsonResponse(text: string, fallbackLabel = "model response"): unknown {
  const candidate = extractBalancedJson(text);

  try {
    return JSON.parse(candidate);
  } catch (error) {
    const preview = truncate(candidate, 400);
    throw new Error(`Unable to parse ${fallbackLabel} as JSON. Preview: ${preview}`);
  }
}

export function truncate(value: string, maxLength = 400): string {
  if (typeof value !== "string" || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function maskSecrets<T>(value: T): T | string {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .replace(/(sk-[a-zA-Z0-9_-]{10,})/g, "sk-***")
    .replace(/(AIza[0-9A-Za-z_-]{10,})/g, "AIza***")
    .replace(/(ya29\.[0-9A-Za-z._-]+)/g, "ya29.***");
}
