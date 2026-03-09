import { fetchWinds } from "../_lib/domain";
import { jsonError, withCors } from "../_lib/proxy";
import type { Env } from "../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return jsonError(400, "lat and lon are required", request, env);
  }

  try {
    const winds = await fetchWinds(context, lat, lon);
    return withCors(Response.json(winds), request, env);
  } catch (error: any) {
    return jsonError(502, error?.message || "Failed to fetch winds", request, env);
  }
}
