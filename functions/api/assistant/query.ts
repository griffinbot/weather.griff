import { fetchBriefing, fetchWinds } from "../../_lib/domain";
import { jsonError, withCors } from "../../_lib/proxy";
import type { AssistantQueryRequest } from "../../../shared/contracts";
import type { Env } from "../../_lib/rateLimiter";

interface EventContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

function windName(degrees: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(degrees / 22.5) % 16];
}

export async function onRequestPost(context: EventContext): Promise<Response> {
  const { request, env } = context;

  try {
    const payload = (await request.json()) as AssistantQueryRequest;
    const question = payload.question.trim();
    if (!question || !payload.location?.airport) {
      return jsonError(400, "question and location are required", request, env);
    }

    const [briefing, winds] = await Promise.all([
      fetchBriefing(context, payload.location),
      fetchWinds(context, payload.location.lat, payload.location.lon),
    ]);

    const lower = question.toLowerCase();
    const current = briefing.current;
    const firstHour = winds.hours[0];
    let answer = "Weather data is unavailable for this location right now.";

    if (current) {
      if (lower.includes("wind")) {
        const strongest = firstHour?.normalizedLevels.reduce((max, row) => Math.max(max, row.windSpeed_mph), 0) ?? 0;
        answer = `Surface winds at ${payload.location.airport} are ${windName(current.windDirection)} at ${current.windSpeed} kt, gusting ${current.windGusts} kt. The strongest sampled winds aloft in the current profile are around ${Math.round(strongest * 0.868976)} kt.`;
      } else if (lower.includes("forecast") || lower.includes("outlook")) {
        const today = briefing.daily[0];
        const tomorrow = briefing.daily[1];
        answer = `Today at ${payload.location.airport}: ${today?.condition ?? current.condition}, high ${today?.high ?? current.temperature}°, low ${today?.low ?? current.feelsLike}°, with gusts up to ${today?.windGusts ?? current.windGusts} kt. Tomorrow trends ${tomorrow?.condition ?? "unavailable"} with highs near ${tomorrow?.high ?? "—"}°.`;
      } else if (lower.includes("metar") || lower.includes("taf")) {
        const station = briefing.stationBundles[0];
        answer = station?.metar
          ? `Primary station ${station.station.stationId} METAR: ${station.metar.raw || station.metar.description || "available"}. ${station.taf?.raw ? `TAF is also available for ${station.station.stationId}.` : "No TAF was found for the primary station."}`
          : `No decoded METAR was available from the current briefing bundle.`;
      } else {
        answer = `Current conditions at ${payload.location.airport}: ${current.condition}, ${current.temperature}°, winds ${windName(current.windDirection)} at ${current.windSpeed} kt, visibility ${current.visibility} mi, cloud cover ${current.cloudCover}%.`;
      }
    }

    return withCors(
      Response.json({ answer, generatedAt: new Date().toISOString() }),
      request,
      env,
    );
  } catch (error: any) {
    return jsonError(500, error?.message || "Assistant query failed", request, env);
  }
}
