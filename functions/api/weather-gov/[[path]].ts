import { fetchJsonWithCache } from "../../_lib/cache";
import {
  HttpError,
  getProxyUserAgent,
  jsonError,
  requireAllowedQuery,
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

function validateWeatherGovPath(path: string): { ttlSeconds: number; staleTtlSeconds: number } {
  const pointsStations = /^points\/-?\d{1,2}(?:\.\d+)?,\-?\d{1,3}(?:\.\d+)?\/stations$/;
  const latestObs = /^stations\/[A-Z0-9]{3,8}\/observations\/latest$/;
  const tafLocations = /^products\/types\/TAF\/locations\/[A-Z0-9]{3,8}$/;
  const product = /^products\/[A-Za-z0-9\-]+$/;

  if (pointsStations.test(path)) return { ttlSeconds: 900, staleTtlSeconds: 3600 };
  if (latestObs.test(path)) return { ttlSeconds: 120, staleTtlSeconds: 600 };
  if (tafLocations.test(path)) return { ttlSeconds: 300, staleTtlSeconds: 1800 };
  if (product.test(path)) return { ttlSeconds: 300, staleTtlSeconds: 1800 };

  throw new HttpError(400, "Unsupported weather.gov path");
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    const incomingUrl = new URL(request.url);
    requireAllowedQuery(incomingUrl.searchParams, new Set());

    const routePath = normalizePath(context.params.path);
    requireRegex(routePath, /^[A-Za-z0-9\-\.,/]+$/, "path");

    const cachePolicy = validateWeatherGovPath(routePath);
    const upstreamUrl = `https://api.weather.gov/${routePath}`;

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: `/api/weather-gov/${routePath}`,
      cacheQuery: incomingUrl.searchParams,
      targetUrl: upstreamUrl,
      ttlSeconds: cachePolicy.ttlSeconds,
      staleTtlSeconds: cachePolicy.staleTtlSeconds,
      upstreamHeaders: {
        "User-Agent": getProxyUserAgent(env),
        "Accept": "application/geo+json, application/json",
      },
    });

    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "weather.gov proxy failed", request, env);
  }
}
