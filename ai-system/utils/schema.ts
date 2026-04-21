import { parseJsonResponse, truncate } from "./string.js";

export function extractStructuredData(value, schema, label = "structured output") {
  const direct = tryNormalizeCandidate(value, schema, label);
  if (direct.ok) {
    return direct.value;
  }

  const queue = [value];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current === "undefined") {
      continue;
    }

    if (typeof current === "object") {
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
    }

    const candidate = tryNormalizeCandidate(current, schema, label);
    if (candidate.ok) {
      return candidate.value;
    }

    if (typeof current === "string") {
      const nested = tryParseJson(current, label);
      if (typeof nested !== "undefined") {
        queue.push(nested);
      }
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current === "object") {
      for (const key of preferredKeys(current)) {
        queue.push(current[key]);
      }
    }
  }

  throw new Error(`Unable to extract ${label}. Preview: ${truncate(stringifyValue(value), 500)}`);
}

export function assertMatchesBasicSchema(value, schema, label = "structured output") {
  const error = firstSchemaError(value, schema, "$");
  if (error) {
    throw new Error(`${label} did not match schema: ${error}`);
  }
}

function tryNormalizeCandidate(value, schema, label) {
  try {
    if (typeof value === "string") {
      const parsed = parseJsonResponse(value, label);
      assertMatchesBasicSchema(parsed, schema, label);
      return { ok: true, value: parsed };
    }

    if (typeof value === "object" && value !== null) {
      assertMatchesBasicSchema(value, schema, label);
      return { ok: true, value };
    }
  } catch {
    return { ok: false };
  }

  return { ok: false };
}

function tryParseJson(value, label) {
  try {
    return parseJsonResponse(value, label);
  } catch {
    return undefined;
  }
}

function preferredKeys(value) {
  const keys = Object.keys(value);
  const preferred = ["result", "response", "content", "text", "message", "output", "data", "payload"];
  const ordered = [];

  for (const key of preferred) {
    if (key in value) {
      ordered.push(key);
    }
  }

  for (const key of keys) {
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered;
}

function stringifyValue(value) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstSchemaError(value, schema, path) {
  if (!schema) {
    return null;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.join(", ")}`;
  }

  switch (schema.type) {
    case "object":
      if (!isPlainObject(value)) {
        return `${path} must be an object`;
      }
      for (const required of schema.required ?? []) {
        if (!(required in value)) {
          return `${path}.${required} is required`;
        }
      }
      if (schema.additionalProperties === false) {
        const allowedKeys = new Set(Object.keys(schema.properties ?? {}));
        for (const key of Object.keys(value)) {
          if (!allowedKeys.has(key)) {
            return `${path}.${key} is not allowed`;
          }
        }
      }
      for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
        if (key in value) {
          const nestedError = firstSchemaError(value[key], childSchema, `${path}.${key}`);
          if (nestedError) {
            return nestedError;
          }
        }
      }
      return null;
    case "array":
      if (!Array.isArray(value)) {
        return `${path} must be an array`;
      }
      for (let index = 0; index < value.length; index += 1) {
        const nestedError = firstSchemaError(value[index], schema.items, `${path}[${index}]`);
        if (nestedError) {
          return nestedError;
        }
      }
      return null;
    case "string":
      return typeof value === "string" ? null : `${path} must be a string`;
    case "number":
      return typeof value === "number" ? null : `${path} must be a number`;
    case "integer":
      return Number.isInteger(value) ? null : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    default:
      return null;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
