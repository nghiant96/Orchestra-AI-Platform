import { assertMatchesBasicSchema, extractStructuredData } from "../utils/schema.js";
import type { CliCommandError, JsonProvider, JsonSchema, Logger, ProviderConfig, RunJsonOptions } from "../types.js";

type OpenAIMessageContent = string | Array<string | { type?: string; text?: string }>;

interface OpenAIChoice {
  message?: { content?: OpenAIMessageContent };
  delta?: { content?: string };
  text?: string;
}

interface OpenAICompatiblePayload {
  choices?: OpenAIChoice[];
  [key: string]: unknown;
}

export class OpenAICompatibleProvider implements JsonProvider {
  config: ProviderConfig;
  logger?: Logger;

  constructor({ config, logger }: { config: ProviderConfig; logger?: Logger }) {
    this.config = config;
    this.logger = logger;
  }

  get id() {
    return this.config.type;
  }

  async runJson<T = unknown>({
    cwd: _cwd,
    label,
    systemPrompt,
    prompt,
    schema,
    timeoutMs,
    retries,
    baseDelayMs,
    signal
  }: RunJsonOptions): Promise<T> {
    const effectiveTimeoutMs = this.config.timeout_ms ?? timeoutMs ?? 60000;
    const effectiveRetries = this.config.retries ?? retries ?? 2;
    const effectiveBaseDelayMs = this.config.base_delay_ms ?? baseDelayMs ?? 500;

    let lastError;
    for (let attempt = 0; attempt <= effectiveRetries; attempt += 1) {
      if (signal?.aborted) throw new Error('AbortError');

      try {
        const responseText = await this.requestJson({
          systemPrompt,
          prompt,
          schema,
          timeoutMs: effectiveTimeoutMs,
          signal
        });
        const parsed = extractStructuredData(responseText, schema, label);
        assertMatchesBasicSchema(parsed, schema, label);
        return parsed as T;
      } catch (error) {
        lastError = error;
        if (attempt === effectiveRetries || !isRetryableHttpError(error)) {
          break;
        }
        await sleep(Math.min(effectiveBaseDelayMs * 2 ** attempt, 8000));
      }
    }

    const normalized = lastError as Error | undefined;
    throw new Error(`${label} failed after ${effectiveRetries + 1} attempt(s): ${normalized?.message ?? "Unknown error"}`);
  }

  async requestJson({
    systemPrompt,
    prompt,
    schema,
    timeoutMs,
    signal
  }: {
    systemPrompt: string;
    prompt: string;
    schema: JsonSchema;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const baseUrl = stripTrailingSlash(this.config.base_url);
    if (!baseUrl) {
      throw new Error("openai-compatible provider requires config.base_url");
    }
    if (!this.config.api_key) {
      throw new Error("openai-compatible provider requires config.api_key");
    }
    if (!this.config.model) {
      throw new Error("openai-compatible provider requires config.model");
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_key}`
      },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        temperature: this.config.temperature ?? 0,
        messages: buildMessages(systemPrompt, prompt, schema),
        response_format: this.config.response_format ?? { type: "json_object" }
      }),
      signal: buildCombinedSignal(timeoutMs, signal)
    });

    const raw = await response.text();
    if (!response.ok) {
      throw buildHttpError(response.status, raw);
    }

    const parsed = parseOpenAICompatiblePayload(raw);
    return extractMessageContent(parsed);
  }
}

function buildCombinedSignal(timeoutMs?: number, externalSignal?: AbortSignal): AbortSignal | undefined {
  const timeoutSignal = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 
    ? AbortSignal.timeout(timeoutMs) 
    : undefined;

  if (!timeoutSignal && !externalSignal) return undefined;
  if (!timeoutSignal) return externalSignal;
  if (!externalSignal) return timeoutSignal;

  return AbortSignal.any([timeoutSignal, externalSignal]);
}

function buildMessages(systemPrompt: string, prompt: string, schema: JsonSchema) {
  const instruction = [
    systemPrompt,
    "",
    "All model outputs must be valid JSON with no markdown, no code fences, and no extra text.",
    "Return exactly one JSON object matching this schema.",
    JSON.stringify(schema, null, 2),
    "",
    "Do not rename keys. Do not add wrapper objects. Do not add commentary.",
    prompt
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: "You are a structured JSON generation assistant."
    },
    {
      role: "user",
      content: instruction
    }
  ];
}

function parseOpenAICompatiblePayload(raw: string): OpenAICompatiblePayload {
  try {
    return JSON.parse(raw);
  } catch {
    return parseSsePayload(raw);
  }
}

function parseSsePayload(raw: string): OpenAICompatiblePayload {
  const events: OpenAICompatiblePayload[] = [];

  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      events.push(JSON.parse(payload));
    } catch {
      continue;
    }
  }

  if (events.length === 0) {
    throw new Error(`openai-compatible provider returned invalid JSON payload: ${truncate(raw, 600)}`);
  }

  let finalMessageContent = "";
  let finalText = "";
  const lastEvent = events.at(-1) ?? {};

  for (const event of events) {
    const choice = Array.isArray(event?.choices) ? event.choices[0] : null;
    const content = choice?.message?.content;
    if (typeof content === "string" && content) {
      finalMessageContent = content;
    }

    const deltaContent = choice?.delta?.content;
    if (typeof deltaContent === "string" && deltaContent) {
      finalText += deltaContent;
    }

    if (typeof choice?.text === "string" && choice.text) {
      finalText += choice.text;
    }
  }

  if (finalMessageContent) {
    return {
      ...lastEvent,
      choices: [
        {
          ...(Array.isArray(lastEvent?.choices) ? lastEvent.choices[0] : {}),
          message: { content: finalMessageContent }
        }
      ]
    };
  }

  if (finalText) {
    return {
      ...lastEvent,
      choices: [
        {
          ...(Array.isArray(lastEvent?.choices) ? lastEvent.choices[0] : {}),
          message: { content: finalText }
        }
      ]
    };
  }

  return lastEvent;
}

function extractMessageContent(payload: OpenAICompatiblePayload): string {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item?.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");

    if (text) {
      return text;
    }
  }

  if (typeof choice?.text === "string") {
    return choice.text;
  }

  throw new Error("openai-compatible provider returned no message content");
}

function buildHttpError(status: number, raw: string): CliCommandError {
  const error: CliCommandError = new Error(`HTTP ${status}: ${truncate(raw, 600)}`);
  error.status = status;
  error.responseText = raw;
  return error;
}

function isRetryableHttpError(error: unknown): boolean {
  const normalized = error as CliCommandError | undefined;
  const status = Number(normalized?.status);
  if (status === 429 || status >= 500) {
    return true;
  }

  const message = `${normalized?.message ?? ""}`.toLowerCase();
  return ["timeout", "temporarily unavailable", "rate limit", "try again", "overloaded", "503", "429"].some((needle) =>
    message.includes(needle)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrailingSlash(value: unknown): string {
  return String(value || "").replace(/\/+$/, "");
}

function truncate(value: unknown, maxChars: number): string {
  const stringValue = String(value ?? "");
  return stringValue.length <= maxChars ? stringValue : `${stringValue.slice(0, maxChars - 3)}...`;
}
