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

function appendQuery(base: string, searchParams: URLSearchParams): string {
  const url = new URL(base);
  searchParams.forEach((value, key) => url.searchParams.append(key, value));
  return url.toString();
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    const upstreamBase = requireEnvVar(env.AVIATIONALERTS_UPSTREAM_URL, "AVIATIONALERTS_UPSTREAM_URL");
    const incomingUrl = new URL(request.url);

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/aviationalerts",
      cacheQuery: incomingUrl.searchParams,
      targetUrl: appendQuery(upstreamBase, incomingUrl.searchParams),
      ttlSeconds: 600,
      staleTtlSeconds: 3600,
      upstreamHeaders: buildUpstreamHeaders(env, "*/*"),
    });
    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "Aviation alerts proxy failed", request, env);
  }
}

