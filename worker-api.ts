import { onRequest as middlewareOnRequest } from "./functions/api/_middleware";
import { onRequestGet as nominatimSearch } from "./functions/api/nominatim/search";
import { onRequestGet as openMeteoForecast } from "./functions/api/open-meteo/forecast";
import { onRequestGet as weatherGovPath } from "./functions/api/weather-gov/[[path]]";
import { jsonError } from "./functions/_lib/proxy";
import { RateLimiterDurableObject } from "./functions/_lib/rateLimiter";
import type { Env } from "./functions/_lib/rateLimiter";

interface ExecutionCtx {
  waitUntil: (promise: Promise<unknown>) => void;
}

function routeRequest(request: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/api/open-meteo/forecast") {
    return openMeteoForecast({ request, env, waitUntil: ctx.waitUntil });
  }

  if (pathname === "/api/nominatim/search") {
    return nominatimSearch({ request, env, waitUntil: ctx.waitUntil });
  }

  if (pathname.startsWith("/api/weather-gov/")) {
    const rawPath = pathname.slice("/api/weather-gov/".length);
    return weatherGovPath({
      request,
      env,
      waitUntil: ctx.waitUntil,
      params: { path: rawPath },
    });
  }

  return jsonError(404, "Unknown API route", request, env);
}

export { RateLimiterDurableObject };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    return middlewareOnRequest({
      request,
      env,
      next: () => routeRequest(request, env, ctx),
    });
  },
};
