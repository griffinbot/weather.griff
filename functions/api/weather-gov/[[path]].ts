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
  params: {
    path?: string | string[];
  };
}

function normalizePath(pathParam: string | string[] | undefined): string {
  if (Array.isArray(pathParam)) return pathParam.join("/");
  return pathParam || "";
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    const incomingUrl = new URL(request.url);
    const routePath = normalizePath(context.params.path);
    if (!routePath) {
      throw new HttpError(400, "Missing weather.gov path");
    }
    requireRegex(routePath, /^[A-Za-z0-9\-\.,/]+$/, "path");

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: `/api/weather-gov/${routePath}`,
      cacheQuery: incomingUrl.searchParams,
      targetUrl: `https://api.weather.gov/${routePath}${incomingUrl.search}`,
      ttlSeconds: 600,
      staleTtlSeconds: 3600,
      upstreamHeaders: buildUpstreamHeaders(env, "application/geo+json, application/json"),
    });

    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "weather.gov proxy failed", request, env);
  }
}
