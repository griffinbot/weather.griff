import { HttpError, requireEnvVar } from "../proxy";
import type { Env } from "../rateLimiter";

interface OpenAIChatJsonOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getApiBase(env: Env): string {
  return (env.OPENAI_API_BASE || "https://api.openai.com").replace(/\/+$/, "");
}

function parseJsonObject<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error("Model did not return valid JSON.");
  }
}

function parseOpenAIError(status: number, payload: any): never {
  const details =
    payload?.error?.message ||
    payload?.message ||
    `OpenAI request failed with status ${status}`;
  if (status === 401 || status === 403) {
    throw new HttpError(502, "OpenAI authentication failed. Check OPENAI_API_KEY.");
  }
  if (status === 429) {
    throw new HttpError(503, "OpenAI rate limit reached. Retry shortly.");
  }
  throw new HttpError(502, details);
}

export async function openAIChatJSON<T>(
  env: Env,
  options: OpenAIChatJsonOptions,
): Promise<T> {
  const apiKey = requireEnvVar(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const model = env.AI_CHAT_MODEL || "gpt-4o-mini";
  const timeoutMs = clamp(options.timeoutMs ?? 20_000, 3_000, 60_000);
  const maxTokens = clamp(options.maxTokens ?? 700, 128, 2_048);
  const temperature = clamp(options.temperature ?? 0.2, 0, 1);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getApiBase(env)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      parseOpenAIError(response.status, payload);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new HttpError(502, "OpenAI returned an empty response.");
    }

    return parseJsonObject<T>(content);
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new HttpError(504, "OpenAI request timed out.");
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, error?.message || "OpenAI request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function openAIEmbedTexts(
  env: Env,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const apiKey = requireEnvVar(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  const model = env.AI_EMBEDDING_MODEL || "text-embedding-3-small";

  const response = await fetch(`${getApiBase(env)}/v1/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: inputs,
    }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    parseOpenAIError(response.status, payload);
  }

  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (data.length !== inputs.length) {
    throw new HttpError(502, "Embedding response length mismatch.");
  }
  return data.map((item: any) => item?.embedding as number[]);
}

