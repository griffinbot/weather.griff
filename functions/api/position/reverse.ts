import { fetchJsonWithCache } from "../../_lib/cache";
import {
  buildUpstreamHeaders,
  HttpError,
  jsonError,
  requireRegex,
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

    const lat = incomingUrl.searchParams.get("lat") || "";
    const lon = incomingUrl.searchParams.get("lon") || "";
    if (!lat || !lon) {
      throw new HttpError(400, "lat and lon are required");
    }
    requireRegex(lat, /^-?\d{1,2}(?:\.\d+)?$/, "lat");
    requireRegex(lon, /^-?\d{1,3}(?:\.\d+)?$/, "lon");

    const upstreamParams = new URLSearchParams(incomingUrl.searchParams);
    if (!upstreamParams.has("format")) {
      upstreamParams.set("format", "json");
    }

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/position/reverse",
      cacheQuery: upstreamParams,
      targetUrl: `https://nominatim.openstreetmap.org/reverse.php?${upstreamParams.toString()}`,
      ttlSeconds: 604800,
      staleTtlSeconds: 1209600,
      upstreamHeaders: buildUpstreamHeaders(env),
    });

    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "Position reverse proxy failed", request, env);
  }
}
