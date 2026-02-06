import { fetchJsonWithCache } from "../../_lib/cache";
import {
  buildUpstreamHeaders,
  HttpError,
  jsonError,
  normalizeQueryString,
  requireAllowedQuery,
  requireRegex,
  withCors,
} from "../../_lib/proxy";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

const ALLOWED_QUERY = new Set([
  "latitude",
  "longitude",
  "current",
  "hourly",
  "daily",
  "temperature_unit",
  "wind_speed_unit",
  "precipitation_unit",
  "timezone",
  "forecast_days",
  "forecast_hours",
  "past_hours",
]);

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const incomingUrl = new URL(request.url);

  try {
    requireAllowedQuery(incomingUrl.searchParams, ALLOWED_QUERY);
    const lat = incomingUrl.searchParams.get("latitude") || "";
    const lon = incomingUrl.searchParams.get("longitude") || "";
    requireRegex(lat, /^-?\d{1,2}(\.\d+)?$/, "latitude");
    requireRegex(lon, /^-?\d{1,3}(\.\d+)?$/, "longitude");

    const normalizedSearch = normalizeQueryString(incomingUrl.searchParams);
    const upstreamUrl = `https://api.open-meteo.com/v1/forecast?${normalizedSearch}`;

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: "/api/open-meteo/forecast",
      cacheQuery: new URLSearchParams(normalizedSearch),
      targetUrl: upstreamUrl,
      ttlSeconds: 600,
      staleTtlSeconds: 3600,
      upstreamHeaders: buildUpstreamHeaders(env),
    });

    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "Open-Meteo proxy failed", request, env);
  }
}
