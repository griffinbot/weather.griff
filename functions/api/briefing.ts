import { fetchBriefing } from "../_lib/domain";
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
  const airport = (url.searchParams.get("airport") || "").trim().toUpperCase();
  const name = (url.searchParams.get("name") || airport || "Selected airport").trim();

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !airport) {
    return jsonError(400, "lat, lon, and airport are required", request, env);
  }

  try {
    const briefing = await fetchBriefing(context, {
      id: `${lat.toFixed(4)},${lon.toFixed(4)}:${airport}`,
      name,
      lat,
      lon,
      airport,
    });
    return withCors(Response.json(briefing), request, env);
  } catch (error: any) {
    return jsonError(502, error?.message || "Failed to fetch briefing", request, env);
  }
}
