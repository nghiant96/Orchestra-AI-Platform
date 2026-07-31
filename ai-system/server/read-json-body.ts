import type http from "node:http";

/**
 * Ceiling on a single request body.
 *
 * Worker log uploads carry raw provider stdout, so the budget has to be roomy;
 * what it must not be is absent. Without a ceiling every route buffers whatever
 * a client sends straight into memory, and one oversized request takes the
 * control plane down.
 */
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export function resolveMaxBodyBytes(): number {
  const configured = Number(process.env.AI_SYSTEM_MAX_BODY_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BODY_BYTES;
}

/** A malformed or oversized request body, carrying the status the client should see. */
export class HttpBodyError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpBodyError";
  }
}

/**
 * Read and parse a JSON request body, refusing anything over the size ceiling.
 *
 * Oversized and unparseable bodies are client mistakes, so they surface as
 * HttpBodyError with 413 and 400 rather than as a generic 500.
 */
export async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const maxBytes = resolveMaxBodyBytes();

  // Trust the declared length only to reject early — never to size a buffer.
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpBodyError(413, `Request body exceeds the ${maxBytes} byte limit`);
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBytes) {
      // Leaving the loop destroys the stream, so a client that keeps sending
      // stops being read rather than filling memory behind our back.
      throw new HttpBodyError(413, `Request body exceeds the ${maxBytes} byte limit`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpBodyError(400, "Request body is not valid JSON");
  }
}
