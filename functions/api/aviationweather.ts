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
    const type = (incomingUrl.searchParams.get("type") || "taf").toLowerCase();
    if (type !== "taf" && type !== "metar") {
      throw new HttpError(400, "Invalid aviationweather type. Expected 'taf' or 'metar'.");
    }

    const upstreamParams = new URLSearchParams(incomingUrl.searchParams);
    upstreamParams.delete("type");
    const query = upstreamParams.toString();
    const upstreamUrl = `https://aviationweather.gov/api/data/${type}${query ? `?${query}` : ""}`;

    const response = await fetchJsonWithCache({
      request,
      ctx: context,
      cacheKeyPath: `/api/aviationweather/${type}`,
      cacheQuery: upstreamParams,
      targetUrl: upstreamUrl,
      ttlSeconds: 600,
      staleTtlSeconds: 3600,
      upstreamHeaders: buildUpstreamHeaders(env, "*/*"),
    });
    return withCors(response, request, env);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonError(error.status, error.message, request, env);
    }
    return jsonError(502, "AviationWeather proxy failed", request, env);
  }
}
