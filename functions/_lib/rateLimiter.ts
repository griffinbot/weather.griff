import { DurableObject } from "cloudflare:workers";

interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

interface CheckRequest {
  key: string;
  config: BucketConfig;
}

interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface Env {
  ALLOWED_ORIGIN?: string;
  PROXY_USER_AGENT?: string;
  TIMEZONEDB_API_KEY?: string;
  GOOGLE_ELEVATION_API_KEY?: string;
  TFR_UPSTREAM_URL?: string;
  AVIATIONALERTS_UPSTREAM_URL?: string;
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  DB?: D1Database;
  RATE_LIMITER: DurableObjectNamespace<RateLimiterDurableObject>;
}

export class RateLimiterDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = (await request.json()) as CheckRequest;
    const result = await this.consumeToken(body.key, body.config);
    return Response.json(result);
  }

  private async consumeToken(key: string, config: BucketConfig): Promise<LimitResult> {
    const now = Date.now();
    const storageKey = `bucket:${key}`;
    const current = (await this.ctx.storage.get<BucketState>(storageKey)) ?? {
      tokens: config.capacity,
      lastRefillMs: now,
    };

    const elapsedSeconds = Math.max(0, (now - current.lastRefillMs) / 1000);
    const refilledTokens = Math.min(
      config.capacity,
      current.tokens + elapsedSeconds * config.refillPerSecond,
    );

    if (refilledTokens >= 1) {
      const updated: BucketState = {
        tokens: refilledTokens - 1,
        lastRefillMs: now,
      };
      await this.ctx.storage.put(storageKey, updated);
      return {
        allowed: true,
        remaining: Math.floor(updated.tokens),
        retryAfterSeconds: 0,
      };
    }

    const missing = 1 - refilledTokens;
    const retryAfterSeconds = Math.ceil(missing / config.refillPerSecond);
    await this.ctx.storage.put(storageKey, {
      tokens: refilledTokens,
      lastRefillMs: now,
    });

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }
}

export async function checkRateLimit(
  env: Env,
  key: string,
  config: BucketConfig,
): Promise<LimitResult> {
  const id = env.RATE_LIMITER.idFromName("global-rate-limiter");
  const stub = env.RATE_LIMITER.get(id);
  const res = await stub.fetch("https://rate-limiter.internal/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, config }),
  });

  if (!res.ok) {
    throw new Error(`Rate limiter failed with status ${res.status}`);
  }

  return (await res.json()) as LimitResult;
}

export function coarseUaHash(userAgent: string): string {
  let hash = 5381;
  for (let i = 0; i < userAgent.length; i++) {
    hash = ((hash << 5) + hash) + userAgent.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(16).slice(0, 8);
}
