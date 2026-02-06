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
    const key = requireEnvVar(env.TIMEZONEDB_API_KEY, "TIMEZONEDB_API_KEY");
    const incomingUrl = new URL(request.url);

    const upstreamParams = new URLSearchParams(incomingUrl.searchParams);
    if (!upstreamParams.has("format")) {
      upstreamParams.set("format", "json");
    }
    upstreamParams.set("key", key);

    const cacheQuery = new URLSearchParams(incomingUrl.searchParams);
    if (!cacheQuery.has("format")) {
      cacheQuery.set("format", "json");
    }

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/timezone",
      cacheQuery,
      targetUrl: `http://api.timezonedb.com/v2.1/get-time-zone?${upstreamParams.toString()}`,
      ttlSeconds: 600,
      staleTtlSeconds: 3600,
      upstreamHeaders: buildUpstreamHeaders(env),
    });

    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "Timezone proxy failed", request, env);
  }
}
