import { fetchJsonWithCache } from "../../_lib/cache";
import {
  buildUpstreamHeaders,
  HttpError,
  jsonError,
  withCors,
} from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    const incomingUrl = new URL(request.url);

    const q = incomingUrl.searchParams.get("q")?.trim() || "";
    if (q.length < 2 || q.length > 120) {
      throw new HttpError(400, "Query must be between 2 and 120 characters");
    }

    const rawLimit = Number.parseInt(incomingUrl.searchParams.get("limit") || "5", 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 10)) : 5;
    const upstreamParams = new URLSearchParams(incomingUrl.searchParams);
    upstreamParams.set("q", q);
    upstreamParams.set("limit", String(limit));
    if (!upstreamParams.has("format")) {
      upstreamParams.set("format", "json");
    }

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/position/search",
      cacheQuery: upstreamParams,
      targetUrl: `https://nominatim.openstreetmap.org/search?${upstreamParams.toString()}`,
      ttlSeconds: 604800,
      staleTtlSeconds: 1209600,
      upstreamHeaders: buildUpstreamHeaders(env),
    });

    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "Position search proxy failed", request, env);
  }
}
