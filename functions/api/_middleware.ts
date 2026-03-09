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
  // Tuned for small-team testing (~5 users) to reduce false 429s from UI bursts.
  "nominatim": { capacity: 60, refillPerSecond: 1 },
  "open-meteo": { capacity: 1200, refillPerSecond: 80 },
  "weather-gov": { capacity: 500, refillPerSecond: 25 },
  "timezone": { capacity: 240, refillPerSecond: 4 },
  "rap": { capacity: 120, refillPerSecond: 2 },
  "aviationweather": { capacity: 240, refillPerSecond: 4 },
  "pqs": { capacity: 240, refillPerSecond: 4 },
  "googleelevation": { capacity: 120, refillPerSecond: 2 },
  "tfr": { capacity: 240, refillPerSecond: 4 },
  "aviationalerts": { capacity: 240, refillPerSecond: 4 },
  "domain": { capacity: 240, refillPerSecond: 12 },
} as const;

const PROVIDER_LIMITS = {
  // Keep provider protection, but allow higher burst for test sessions.
  // Nominatim stays intentionally conservative versus other upstreams.
  "nominatim": { capacity: 120, refillPerSecond: 1.5 },
  "open-meteo": { capacity: 20000, refillPerSecond: 700 },
  "weather-gov": { capacity: 5000, refillPerSecond: 180 },
  "timezone": { capacity: 2400, refillPerSecond: 40 },
  "rap": { capacity: 1000, refillPerSecond: 16 },
  "aviationweather": { capacity: 2400, refillPerSecond: 40 },
  "pqs": { capacity: 2400, refillPerSecond: 40 },
  "googleelevation": { capacity: 1000, refillPerSecond: 16 },
  "tfr": { capacity: 2400, refillPerSecond: 40 },
  "aviationalerts": { capacity: 2400, refillPerSecond: 40 },
  "domain": { capacity: 2400, refillPerSecond: 120 },
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
  if (pathname === "/api/briefing") return "domain";
  if (pathname === "/api/winds") return "domain";
  if (pathname === "/api/search") return "domain";
  if (pathname.startsWith("/api/profile")) return "domain";
  if (pathname === "/api/assistant/query") return "domain";
  if (pathname === "/api/flight/brief") return "domain";
  if (pathname.startsWith("/api/nominatim/")) return "nominatim";
  if (pathname.startsWith("/api/position/")) return "nominatim";
  if (pathname.startsWith("/api/open-meteo/")) return "open-meteo";
  if (pathname.startsWith("/api/openmeteo/")) return "open-meteo";
  if (pathname.startsWith("/api/weather-gov/")) return "weather-gov";
  if (pathname.startsWith("/api/weather/")) return "weather-gov";
  if (pathname === "/api/timezone") return "timezone";
  if (pathname === "/api/rap") return "rap";
  if (pathname === "/api/aviationweather") return "aviationweather";
  if (pathname === "/api/pqs") return "pqs";
  if (pathname === "/api/googleelevation") return "googleelevation";
  if (pathname === "/api/tfr") return "tfr";
  if (pathname === "/api/aviationalerts") return "aviationalerts";
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

  const isMutableDomainRoute =
    url.pathname.startsWith("/api/profile") ||
    url.pathname === "/api/assistant/query" ||
    url.pathname === "/api/flight/brief";
  const allowedMethod =
    request.method === "GET" ||
    (isMutableDomainRoute && (request.method === "PUT" || request.method === "POST"));

  if (!allowedMethod) {
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
