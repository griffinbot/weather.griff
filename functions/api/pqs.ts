import { fetchJsonWithCache } from "../_lib/cache";
import {
  buildUpstreamHeaders,
  HttpError,
  jsonError,
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
    const incomingUrl = new URL(request.url);
    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/pqs",
      cacheQuery: incomingUrl.searchParams,
      targetUrl: `https://epqs.nationalmap.gov/v1/json${incomingUrl.search}`,
      ttlSeconds: 86400,
      staleTtlSeconds: 604800,
      upstreamHeaders: buildUpstreamHeaders(env),
    });
    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "PQS proxy failed", request, env);
  }
}

