import { assertMatchesBasicSchema, extractStructuredData } from "../utils/schema.js";

export class OpenAICompatibleProvider {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  get id() {
    return this.config.type;
  }

  async runJson({ cwd, label, systemPrompt, prompt, schema, timeoutMs, retries, baseDelayMs }) {
    const effectiveTimeoutMs = this.config.timeout_ms ?? timeoutMs ?? 60000;
    const effectiveRetries = this.config.retries ?? retries ?? 2;
    const effectiveBaseDelayMs = this.config.base_delay_ms ?? baseDelayMs ?? 500;

    let lastError;
    for (let attempt = 0; attempt <= effectiveRetries; attempt += 1) {
      try {
        const responseText = await this.requestJson({
          systemPrompt,
          prompt,
          schema,
          timeoutMs: effectiveTimeoutMs
        });
        const parsed = extractStructuredData(responseText, schema, label);
        assertMatchesBasicSchema(parsed, schema, label);
        return parsed;
      } catch (error) {
        lastError = error;
        if (attempt === effectiveRetries || !isRetryableHttpError(error)) {
          break;
        }
        await sleep(Math.min(effectiveBaseDelayMs * 2 ** attempt, 8000));
      }
    }

    throw new Error(`${label} failed after ${effectiveRetries + 1} attempt(s): ${lastError?.message ?? "Unknown error"}`);
  }

  async requestJson({ systemPrompt, prompt, schema, timeoutMs }) {
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
        temperature: this.config.temperature ?? 0,
        messages: buildMessages(systemPrompt, prompt, schema),
        response_format: this.config.response_format ?? { type: "json_object" }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const raw = await response.text();
    if (!response.ok) {
      throw buildHttpError(response.status, raw);
    }

    const parsed = JSON.parse(raw);
    return extractMessageContent(parsed);
  }
}

function buildMessages(systemPrompt, prompt, schema) {
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

function extractMessageContent(payload) {
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

function buildHttpError(status, raw) {
  const error = new Error(`HTTP ${status}: ${truncate(raw, 600)}`);
  error.status = status;
  error.responseText = raw;
  return error;
}

function isRetryableHttpError(error) {
  const status = Number(error?.status);
  if (status === 429 || status >= 500) {
    return true;
  }

  const message = `${error?.message ?? ""}`.toLowerCase();
  return ["timeout", "temporarily unavailable", "rate limit", "try again", "overloaded", "503", "429"].some((needle) =>
    message.includes(needle)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function truncate(value, maxChars) {
  const stringValue = String(value ?? "");
  return stringValue.length <= maxChars ? stringValue : `${stringValue.slice(0, maxChars - 3)}...`;
}
