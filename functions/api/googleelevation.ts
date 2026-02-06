import { fetchJsonWithCache } from "../_lib/cache";
import {
  buildUpstreamHeaders,
  HttpError,
  jsonError,
  requireEnvVar,
  withCors,
} from "../_lib/proxy";
import type { Env } from "../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    const key = requireEnvVar(env.GOOGLE_ELEVATION_API_KEY, "GOOGLE_ELEVATION_API_KEY");
    const incomingUrl = new URL(request.url);
    const upstreamParams = new URLSearchParams(incomingUrl.searchParams);
    upstreamParams.set("key", key);

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/googleelevation",
      cacheQuery: incomingUrl.searchParams,
      targetUrl: `https://maps.googleapis.com/maps/api/elevation/json?${upstreamParams.toString()}`,
      ttlSeconds: 86400,
      staleTtlSeconds: 604800,
      upstreamHeaders: buildUpstreamHeaders(env),
    });
    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "Google elevation proxy failed", request, env);
  }
}

