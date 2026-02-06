import { fetchJsonWithCache } from "../../_lib/cache";
import {
  HttpError,
  jsonError,
  requireAllowedQuery,
  withCors,
} from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

const ALLOWED_QUERY = new Set(["q", "limit"]);

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    const incomingUrl = new URL(request.url);
    requireAllowedQuery(incomingUrl.searchParams, ALLOWED_QUERY);

    const q = incomingUrl.searchParams.get("q")?.trim() || "";
    if (q.length < 3 || q.length > 120) {
      throw new HttpError(400, "Query must be between 3 and 120 characters");
    }

    const rawLimit = Number.parseInt(incomingUrl.searchParams.get("limit") || "5", 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 5)) : 5;

    const upstreamParams = new URLSearchParams({
      q,
      format: "json",
      addressdetails: "1",
      extratags: "1",
      countrycodes: "us",
      limit: String(limit),
    });

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/nominatim/search",
      cacheQuery: upstreamParams,
      targetUrl: `https://nominatim.openstreetmap.org/search?${upstreamParams.toString()}`,
      ttlSeconds: 3600,
      staleTtlSeconds: 7200,
      upstreamHeaders: {
        "Accept": "application/json",
      },
    });

    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "Nominatim proxy failed", request, env);
  }
}
