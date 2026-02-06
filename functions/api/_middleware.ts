import {
  buildCorsHeaders,
  getAllowedOrigin,
  jsonError,
  withCors,
} from "../_lib/proxy";
import { checkRateLimit, coarseUaHash } from "../_lib/rateLimiter";
import type { Env } from "../_lib/rateLimiter";
export { RateLimiterDurableObject } from "../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const CLIENT_LIMITS = {
  "nominatim": { capacity: 30, refillPerSecond: 0.5 },
  // Open-Meteo and weather.gov are used for core app data and can burst on
  // initial dashboard load (multiple panels + saved locations).
  "open-meteo": { capacity: 300, refillPerSecond: 20 },
  "weather-gov": { capacity: 180, refillPerSecond: 8 },
} as const;

const PROVIDER_LIMITS = {
  "nominatim": { capacity: 120, refillPerSecond: 2 },
  // Keep provider protection, but high enough to avoid false 429s.
  "open-meteo": { capacity: 12000, refillPerSecond: 400 },
  "weather-gov": { capacity: 3000, refillPerSecond: 100 },
} as const;

function getClientIp(request: Request): string {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("X-Forwarded-For");
  if (!forwarded) return "unknown";
  const first = forwarded.split(",")[0]?.trim();
  return first || "unknown";
}

function providerFromPath(pathname: string): keyof typeof CLIENT_LIMITS | null {
  if (pathname.startsWith("/api/nominatim/")) return "nominatim";
  if (pathname.startsWith("/api/open-meteo/")) return "open-meteo";
  if (pathname.startsWith("/api/weather-gov/")) return "weather-gov";
  return null;
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const allowedOrigin = getAllowedOrigin(request, env);
  const origin = request.headers.get("Origin");

  if (origin && origin !== allowedOrigin) {
    return jsonError(403, "Origin not allowed", request, env);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
  }

  if (request.method !== "GET") {
    return jsonError(405, "Method not allowed", request, env);
  }

  const provider = providerFromPath(url.pathname);
  if (!provider) {
    return jsonError(404, "Unknown API route", request, env);
  }

  const ip = getClientIp(request);
  const ua = request.headers.get("User-Agent") || "unknown";
  const uaHash = coarseUaHash(ua);

  try {
    const clientLimit = await checkRateLimit(
      env,
      `${provider}:client:${ip}:${uaHash}`,
      CLIENT_LIMITS[provider],
    );

    if (!clientLimit.allowed) {
      return jsonError(
        429,
        "Rate limit exceeded",
        request,
        env,
        {
          "Retry-After": clientLimit.retryAfterSeconds,
          "X-RateLimit-Limit": CLIENT_LIMITS[provider].capacity,
          "X-RateLimit-Remaining": clientLimit.remaining,
          "X-RateLimit-Provider": provider,
          "X-RateLimit-Retry-After": clientLimit.retryAfterSeconds,
        },
      );
    }

    const providerLimit = await checkRateLimit(
      env,
      `${provider}:global`,
      PROVIDER_LIMITS[provider],
    );

    if (!providerLimit.allowed) {
      return jsonError(
        429,
        "Upstream provider rate limit protection triggered",
        request,
        env,
        {
          "Retry-After": providerLimit.retryAfterSeconds,
          "X-RateLimit-Provider-Limit": PROVIDER_LIMITS[provider].capacity,
          "X-RateLimit-Provider-Remaining": providerLimit.remaining,
          "X-RateLimit-Provider": provider,
          "X-RateLimit-Retry-After": providerLimit.retryAfterSeconds,
        },
      );
    }

    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set("X-RateLimit-Limit", String(CLIENT_LIMITS[provider].capacity));
    headers.set("X-RateLimit-Remaining", String(clientLimit.remaining));
    headers.set("X-RateLimit-Provider-Limit", String(PROVIDER_LIMITS[provider].capacity));
    headers.set("X-RateLimit-Provider-Remaining", String(providerLimit.remaining));
    headers.set("X-RateLimit-Provider", provider);

    return withCors(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      request,
      env,
    );
  } catch (error) {
    return jsonError(500, "Proxy middleware failed", request, env);
  }
}
