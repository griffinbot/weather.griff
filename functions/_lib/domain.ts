import { fetchJsonWithCache } from "./cache";
import { buildUpstreamHeaders } from "./proxy";
import type { Env } from "./rateLimiter";
import type {
  BriefingResponse,
  CurrentWeatherData,
  DailyForecastData,
  DiscussionData,
  HourlyForecastData,
  MetarData,
  NearbyStation,
  SearchResultNormalized,
  TafData,
  WindAloftHour,
  WindResponse,
  PressureLevelRow,
  NearSurfaceLevelRow,
} from "../../shared/contracts";

interface ContextLike {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

interface SearchResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  class?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country_code?: string;
  };
  extratags?: {
    iata?: string;
    icao?: string;
    ref?: string;
    local_ref?: string;
    [key: string]: string | undefined;
  };
}

interface OpenMeteoGeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  admin1?: string;
}

const PRESSURE_LEVELS = [
  1000, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350,
  300, 250,
] as const;

const NEAR_SURFACE_LEVELS_M = [80, 120, 180] as const;
const NORMALIZED_ALTITUDES_AGL = [
  100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000,
  8000, 9000, 10000, 12000, 14000, 16000, 18000,
];

function getWeatherCondition(code: number): string {
  const map: Record<number, string> = {
    0: "Clear Sky",
    1: "Mainly Clear",
    2: "Partly Cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime Fog",
    51: "Light Drizzle",
    53: "Moderate Drizzle",
    55: "Dense Drizzle",
    56: "Lt Freezing Drizzle",
    57: "Freezing Drizzle",
    61: "Light Rain",
    63: "Moderate Rain",
    65: "Heavy Rain",
    66: "Lt Freezing Rain",
    67: "Freezing Rain",
    71: "Light Snow",
    73: "Moderate Snow",
    75: "Heavy Snow",
    77: "Snow Grains",
    80: "Light Showers",
    81: "Moderate Showers",
    82: "Violent Showers",
    85: "Light Snow Showers",
    86: "Heavy Snow Showers",
    95: "Thunderstorm",
    96: "T-Storm w/ Hail",
    99: "Severe T-Storm",
  };
  return map[code] ?? "Unknown";
}

function getWeatherIcon(code: number): CurrentWeatherData["icon"] {
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code >= 56 && code <= 67) return "freezing";
  if (code >= 61 && code <= 65) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

async function fetchCachedJson<T>(
  context: ContextLike,
  cacheKeyPath: string,
  cacheQuery: URLSearchParams,
  targetUrl: string,
  ttlSeconds: number,
  staleTtlSeconds: number,
  accept = "application/json",
): Promise<T> {
  const response = await fetchJsonWithCache({
    request: context.request,
    ctx: context,
    cacheKeyPath,
    cacheQuery,
    targetUrl,
    ttlSeconds,
    staleTtlSeconds,
    upstreamHeaders: buildUpstreamHeaders(context.env, accept),
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed (${response.status})`);
  }

  return response.json<T>();
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusMiles = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(radiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function normalizeAirportCode(value: string | undefined | null): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{3,5}$/.test(normalized)) return null;
  return normalized;
}

function normalizeIcaoCode(value: string | undefined | null): string | null {
  const normalized = normalizeAirportCode(value);
  if (!normalized || !/^[A-Z]{4}$/.test(normalized)) return null;
  return normalized;
}

function isUSResult(result: SearchResult): boolean {
  const countryCode = result.address?.country_code?.toLowerCase();
  if (countryCode) return countryCode === "us";
  return result.display_name.toLowerCase().includes("united states");
}

function isAirportLike(result: SearchResult): boolean {
  return (
    !!result.extratags?.iata ||
    !!result.extratags?.icao ||
    result.class === "aeroway" ||
    result.type === "aerodrome" ||
    result.display_name.toLowerCase().includes("airport")
  );
}

function bestAirportCodeFromResult(result: SearchResult): string | null {
  const directIcao = normalizeIcaoCode(result.extratags?.icao);
  if (directIcao) return directIcao;

  const iata = normalizeAirportCode(result.extratags?.iata);
  if (iata && /^[A-Z]{3}$/.test(iata) && isUSResult(result)) return `K${iata}`;

  return (
    normalizeIcaoCode(result.extratags?.ref) ||
    normalizeIcaoCode(result.extratags?.local_ref)
  );
}

function dedupeByPlaceId(results: SearchResult[]): SearchResult[] {
  const seen = new Set<number>();
  return results.filter((result) => {
    if (seen.has(result.place_id)) return false;
    seen.add(result.place_id);
    return true;
  });
}

function prioritizeSearchResults(results: SearchResult[], query: string): SearchResult[] {
  const airportCodeQuery = query.trim().toUpperCase();
  return [...results].sort((a, b) => {
    const airportDelta = Number(isAirportLike(b)) - Number(isAirportLike(a));
    if (airportDelta !== 0) return airportDelta;

    const aCode = a.extratags?.icao?.toUpperCase() || a.extratags?.iata?.toUpperCase() || "";
    const bCode = b.extratags?.icao?.toUpperCase() || b.extratags?.iata?.toUpperCase() || "";
    const codeDelta = Number(bCode === airportCodeQuery) - Number(aCode === airportCodeQuery);
    if (codeDelta !== 0) return codeDelta;

    return a.display_name.localeCompare(b.display_name);
  });
}

function normalizeLocationName(result: SearchResult): string {
  let locationName = result.display_name.split(",")[0] || result.display_name;
  const city = result.address?.city || result.address?.town || result.address?.village;
  const state = result.address?.state;
  if (city && state) {
    const stateAbbrev = state
      .split(" ")
      .map((part) => part.slice(0, 2).toUpperCase())
      .join("");
    locationName = `${city}, ${stateAbbrev}`;
  }
  return locationName;
}

function normalizeDiscussionSection(text: string): string {
  const normalized = text.replace(/\r/g, "").trim();
  const startIndex = normalized.search(/AREA FORECAST DISCUSSION|\.SYNOPSIS|\.(SHORT TERM|DISCUSSION)/i);
  return startIndex > 0 ? normalized.slice(startIndex).trim() : normalized;
}

function stationIdCandidates(stationId: string): string[] {
  const normalized = stationId.trim().toUpperCase();
  const candidates = [normalized];
  if ((normalized.startsWith("K") || normalized.startsWith("P")) && normalized.length === 4) {
    candidates.push(normalized.slice(1));
  }
  return Array.from(new Set(candidates));
}

function icaoToLocationId(icao: string): string {
  if (icao.length === 4 && (icao.startsWith("K") || icao.startsWith("P"))) return icao.slice(1);
  return icao;
}

function resolveProductPath(product: any): string | null {
  if (typeof product?.["@id"] === "string") {
    const path = new URL(product["@id"]).pathname;
    return path.startsWith("/") ? path.slice(1) : path;
  }
  if (typeof product?.id === "string") return `products/${product.id}`;
  if (typeof product?.id === "number") return `products/${String(product.id)}`;
  return null;
}

function officeMatchesProduct(product: any, officeCode: string): boolean {
  const code = officeCode.toUpperCase();
  const issuingOffice = String(product?.issuingOffice ?? product?.office ?? "").toUpperCase();
  const wmo = String(product?.wmoCollectiveId ?? product?.productIdentifier ?? "").toUpperCase();
  return issuingOffice.includes(`/${code}`) || issuingOffice.endsWith(code) || wmo.includes(code);
}

function normalizeOfficeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cleaned)) return null;
  return cleaned;
}

function officeCodeFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const part = value.split("/").filter(Boolean).pop();
  return normalizeOfficeCode(part ?? null);
}

function extractRawMetar(payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed || trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return "";
    return trimmed;
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const nested = extractRawMetar(entry);
      if (nested) return nested;
    }
    return "";
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const field of ["rawOb", "raw_text", "rawText", "raw", "metar", "METAR"]) {
      const value = record[field];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
    for (const value of Object.values(record)) {
      const nested = extractRawMetar(value);
      if (nested) return nested;
    }
  }
  return "";
}

function normalizeDirection(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

type WindHeightSample = {
  heightFt: number;
  speedMph: number;
  directionDeg: number;
};

type ScalarHeightSample = {
  heightFt: number;
  value: number;
};

function interpolateScalarAtHeight(samples: ScalarHeightSample[], targetHeightFt: number): number | null {
  const sorted = [...samples].sort((a, b) => a.heightFt - b.heightFt);
  if (sorted.length === 0) return null;
  if (targetHeightFt <= sorted[0].heightFt) return sorted[0].value;
  if (targetHeightFt >= sorted[sorted.length - 1].heightFt) return sorted[sorted.length - 1].value;
  for (let index = 0; index < sorted.length - 1; index++) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    if (targetHeightFt < lower.heightFt || targetHeightFt > upper.heightFt) continue;
    const range = upper.heightFt - lower.heightFt;
    if (range <= 0) return lower.value;
    const factor = (targetHeightFt - lower.heightFt) / range;
    return lower.value + factor * (upper.value - lower.value);
  }
  return sorted[sorted.length - 1].value;
}

function interpolateWindAtHeight(
  samples: WindHeightSample[],
  targetHeightFt: number,
): { speedMph: number; directionDeg: number } | null {
  const sorted = [...samples].sort((a, b) => a.heightFt - b.heightFt);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) {
    return {
      speedMph: Math.max(0, sorted[0].speedMph),
      directionDeg: normalizeDirection(sorted[0].directionDeg),
    };
  }

  let lower = sorted[0];
  let upper = sorted[sorted.length - 1];
  for (let index = 0; index < sorted.length; index++) {
    if (sorted[index].heightFt <= targetHeightFt) lower = sorted[index];
    if (sorted[index].heightFt >= targetHeightFt) {
      upper = sorted[index];
      break;
    }
  }

  if (lower.heightFt === upper.heightFt) {
    return {
      speedMph: Math.max(0, lower.speedMph),
      directionDeg: normalizeDirection(lower.directionDeg),
    };
  }

  const factor = (targetHeightFt - lower.heightFt) / (upper.heightFt - lower.heightFt);
  const lowerX = lower.speedMph * Math.cos((lower.directionDeg * Math.PI) / 180);
  const lowerY = lower.speedMph * Math.sin((lower.directionDeg * Math.PI) / 180);
  const upperX = upper.speedMph * Math.cos((upper.directionDeg * Math.PI) / 180);
  const upperY = upper.speedMph * Math.sin((upper.directionDeg * Math.PI) / 180);
  const interpolatedX = lowerX + factor * (upperX - lowerX);
  const interpolatedY = lowerY + factor * (upperY - lowerY);
  return {
    speedMph: Math.max(0, Math.sqrt(interpolatedX ** 2 + interpolatedY ** 2)),
    directionDeg: normalizeDirection((Math.atan2(interpolatedY, interpolatedX) * 180) / Math.PI),
  };
}

export function interpolateToAGL(levels: PressureLevelRow[], targetAGL_ft: number): PressureLevelRow | null {
  const sorted = [...levels].sort((a, b) => a.altitudeAGL_ft - b.altitudeAGL_ft);
  if (sorted.length === 0) return null;
  if (targetAGL_ft <= sorted[0].altitudeAGL_ft) return { ...sorted[0], altitudeAGL_ft: targetAGL_ft };
  if (targetAGL_ft >= sorted[sorted.length - 1].altitudeAGL_ft) {
    return { ...sorted[sorted.length - 1], altitudeAGL_ft: targetAGL_ft };
  }

  for (let index = 0; index < sorted.length - 1; index++) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    if (targetAGL_ft < lower.altitudeAGL_ft || targetAGL_ft > upper.altitudeAGL_ft) continue;
    const range = upper.altitudeAGL_ft - lower.altitudeAGL_ft;
    const factor = range === 0 ? 0 : (targetAGL_ft - lower.altitudeAGL_ft) / range;
    let directionDelta = upper.windDirection - lower.windDirection;
    if (directionDelta > 180) directionDelta -= 360;
    if (directionDelta < -180) directionDelta += 360;
    return {
      pressureLevel: Math.round(lower.pressureLevel + factor * (upper.pressureLevel - lower.pressureLevel)),
      altitudeMSL_m: Math.round(lower.altitudeMSL_m + factor * (upper.altitudeMSL_m - lower.altitudeMSL_m)),
      altitudeMSL_ft: Math.round(lower.altitudeMSL_ft + factor * (upper.altitudeMSL_ft - lower.altitudeMSL_ft)),
      altitudeAGL_ft: targetAGL_ft,
      temperature_F: Math.round(lower.temperature_F + factor * (upper.temperature_F - lower.temperature_F)),
      windSpeed_mph: Math.round(lower.windSpeed_mph + factor * (upper.windSpeed_mph - lower.windSpeed_mph)),
      windDirection: Math.round(((lower.windDirection + factor * directionDelta) % 360 + 360) % 360),
    };
  }
  return null;
}

export async function fetchSearchResults(context: ContextLike, query: string): Promise<SearchResultNormalized[]> {
  const trimmed = query.trim();
  const normalizedCodeQuery = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const looksLikeAirportCode = /^[A-Z0-9]{3,4}$/.test(normalizedCodeQuery);
  const nominatimParams = new URLSearchParams({
    q: trimmed,
    format: "json",
    addressdetails: "1",
    extratags: "1",
    countrycodes: "us",
    limit: "8",
  });

  const nominatim = await fetchCachedJson<SearchResult[]>(
    context,
    "/api/search/nominatim",
    nominatimParams,
    `https://nominatim.openstreetmap.org/search?${nominatimParams.toString()}`,
    86400,
    604800,
  ).catch(() => []);

  let results = prioritizeSearchResults(dedupeByPlaceId(nominatim.filter(isUSResult)), trimmed);

  if (results.filter((item) => bestAirportCodeFromResult(item)).length === 0) {
    const geoParams = new URLSearchParams({
      name: trimmed,
      count: "8",
      language: "en",
      format: "json",
      countryCode: "US",
    });
    const geoJson = await fetchCachedJson<{ results?: OpenMeteoGeocodingResult[] }>(
      context,
      "/api/search/open-meteo",
      geoParams,
      `https://geocoding-api.open-meteo.com/v1/search?${geoParams.toString()}`,
      86400,
      604800,
    ).catch(() => ({ results: [] }));

    if (looksLikeAirportCode && Array.isArray(geoJson.results)) {
      results = geoJson.results.map((result) => ({
        place_id: result.id,
        lat: String(result.latitude),
        lon: String(result.longitude),
        display_name: [result.name, result.admin1, result.country_code].filter(Boolean).join(", "),
        type: "place",
        class: "place",
        address: {
          city: result.name,
          state: result.admin1,
          country_code: result.country_code?.toLowerCase(),
        },
        extratags:
          normalizedCodeQuery.length === 4
            ? { icao: normalizedCodeQuery }
            : { iata: normalizedCodeQuery, icao: `K${normalizedCodeQuery}` },
      }));
    }
  }

  return results
    .filter((item) => looksLikeAirportCode || isAirportLike(item))
    .slice(0, 8)
    .map((result) => ({
      id: String(result.place_id),
      name: normalizeLocationName(result),
      subtitle: result.display_name.split(",").slice(1).join(",").trim(),
      lat: Number(result.lat),
      lon: Number(result.lon),
      airport: bestAirportCodeFromResult(result),
      source: result.class === "place" ? "open-meteo" : "nominatim",
    }));
}

export async function fetchWeatherBundle(
  context: ContextLike,
  lat: number,
  lon: number,
): Promise<{
  current: CurrentWeatherData | null;
  hourly: HourlyForecastData[];
  daily: DailyForecastData[];
}> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "surface_pressure",
      "cloud_cover",
      "precipitation",
      "is_day",
    ].join(","),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "relative_humidity_2m",
      "precipitation_probability",
      "visibility",
      "cloud_cover",
      "dew_point_2m",
    ].join(","),
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "weather_code",
      "wind_speed_10m_max",
      "wind_direction_10m_dominant",
      "wind_gusts_10m_max",
      "precipitation_probability_max",
      "precipitation_sum",
      "sunrise",
      "sunset",
      "uv_index_max",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "kn",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: "7",
    forecast_hours: "48",
  });

  const data = await fetchCachedJson<any>(
    context,
    "/api/open-meteo/forecast",
    params,
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    600,
    3600,
  );

  const current: CurrentWeatherData = {
    temperature: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    humidity: data.current.relative_humidity_2m,
    weatherCode: data.current.weather_code,
    condition: getWeatherCondition(data.current.weather_code),
    icon: getWeatherIcon(data.current.weather_code),
    windSpeed: Math.round(data.current.wind_speed_10m),
    windDirection: data.current.wind_direction_10m,
    windGusts: Math.round(data.current.wind_gusts_10m),
    pressure: Math.round(data.current.surface_pressure * 0.02953 * 100) / 100,
    visibility: Math.round(((data.hourly?.visibility?.[0] ?? 16093.4) / 1609.34) * 10) / 10,
    cloudCover: data.current.cloud_cover,
    dewPoint: Math.round(data.hourly?.dew_point_2m?.[0] ?? data.current.temperature_2m - 10),
    precipitation: data.current.precipitation,
    isDay: data.current.is_day === 1,
  };

  const hourly: HourlyForecastData[] = (data.hourly.time as string[]).map((time: string, index: number) => ({
    time,
    temperature: Math.round(data.hourly.temperature_2m[index]),
    feelsLike: Math.round(data.hourly.apparent_temperature[index]),
    weatherCode: data.hourly.weather_code[index],
    condition: getWeatherCondition(data.hourly.weather_code[index]),
    icon: getWeatherIcon(data.hourly.weather_code[index]),
    windSpeed: Math.round(data.hourly.wind_speed_10m[index]),
    windDirection: data.hourly.wind_direction_10m[index],
    windGusts: Math.round(data.hourly.wind_gusts_10m[index]),
    humidity: data.hourly.relative_humidity_2m[index],
    precipitationProbability: data.hourly.precipitation_probability[index] ?? 0,
    visibility: Math.round((data.hourly.visibility[index] / 1609.34) * 10) / 10,
    cloudCover: data.hourly.cloud_cover[index],
    dewPoint: Math.round(data.hourly.dew_point_2m[index]),
  }));

  const daily: DailyForecastData[] = (data.daily.time as string[]).map((date: string, index: number) => ({
    date: `${date}T12:00:00`,
    high: Math.round(data.daily.temperature_2m_max[index]),
    low: Math.round(data.daily.temperature_2m_min[index]),
    weatherCode: data.daily.weather_code[index],
    condition: getWeatherCondition(data.daily.weather_code[index]),
    icon: getWeatherIcon(data.daily.weather_code[index]),
    windSpeed: Math.round(data.daily.wind_speed_10m_max[index]),
    windDirection: data.daily.wind_direction_10m_dominant[index],
    windGusts: Math.round(data.daily.wind_gusts_10m_max[index]),
    precipitationProbability: data.daily.precipitation_probability_max[index] ?? 0,
    precipitationSum: data.daily.precipitation_sum[index],
    sunrise: data.daily.sunrise[index],
    sunset: data.daily.sunset[index],
    uvIndexMax: data.daily.uv_index_max[index],
  }));

  return { current, hourly, daily };
}

export async function fetchNearbyStationsBundle(
  context: ContextLike,
  lat: number,
  lon: number,
): Promise<NearbyStation[]> {
  const data = await fetchCachedJson<any>(
    context,
    "/api/weather-gov/points-stations",
    new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) }),
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations`,
    900,
    3600,
    "application/geo+json, application/json",
  );

  const features: any[] = data.features ?? data.observationStations ?? [];
  return features
    .slice(0, 6)
    .map((feature) => {
      const props = feature.properties ?? {};
      const coords = feature.geometry?.coordinates ?? [0, 0];
      return {
        stationId: props.stationIdentifier ?? "",
        name: props.name ?? "Unknown",
        lat: coords[1],
        lon: coords[0],
        elevation_m: props.elevation?.value ?? null,
        distance_mi: haversine(lat, lon, coords[1], coords[0]),
      } satisfies NearbyStation;
    })
    .filter((station) => station.stationId);
}

export async function fetchMetar(context: ContextLike, stationId: string): Promise<MetarData | null> {
  const ids = stationIdCandidates(stationId).join(",");
  const aviationWeather = await fetchCachedJson<any[] | Record<string, unknown>>(
    context,
    "/api/aviationweather/metar",
    new URLSearchParams({ ids, format: "json" }),
    `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(ids)}&format=json`,
    180,
    900,
    "*/*",
  ).catch(() => null);

  let weatherGovProps: any = {};
  try {
    const weatherGov = await fetchCachedJson<any>(
      context,
      "/api/weather-gov/latest-observation",
      new URLSearchParams({ stationId }),
      `https://api.weather.gov/stations/${stationId}/observations/latest`,
      180,
      900,
      "application/geo+json, application/json",
    );
    weatherGovProps = weatherGov?.properties ?? {};
  } catch {
    weatherGovProps = {};
  }

  const rawMetar = weatherGovProps.rawMessage || extractRawMetar(aviationWeather);
  const hasStructured =
    typeof weatherGovProps.timestamp === "string" ||
    typeof weatherGovProps.textDescription === "string" ||
    weatherGovProps.temperature?.value != null;
  if (!rawMetar && !hasStructured) return null;

  return {
    raw: rawMetar,
    timestamp: weatherGovProps.timestamp ?? new Date().toISOString(),
    description: weatherGovProps.textDescription ?? "",
    temperature_C: weatherGovProps.temperature?.value ?? null,
    dewpoint_C: weatherGovProps.dewpoint?.value ?? null,
    windDirection: weatherGovProps.windDirection?.value ?? null,
    windSpeed_kmh: weatherGovProps.windSpeed?.value ?? null,
    windGust_kmh: weatherGovProps.windGust?.value ?? null,
    visibility_m: weatherGovProps.visibility?.value ?? null,
    barometricPressure_Pa: weatherGovProps.barometricPressure?.value ?? null,
    relativeHumidity: weatherGovProps.relativeHumidity?.value ?? null,
    cloudLayers: (weatherGovProps.cloudLayers ?? []).map((layer: any) => ({
      base_m: layer.base?.value ?? null,
      amount: layer.amount ?? "CLR",
    })),
  };
}

export async function fetchTaf(context: ContextLike, stationId: string): Promise<TafData | null> {
  const ids = stationIdCandidates(stationId).join(",");
  const aviationWeather = await fetchCachedJson<any[] | Record<string, unknown>>(
    context,
    "/api/aviationweather/taf",
    new URLSearchParams({ ids, format: "json" }),
    `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(ids)}&format=json`,
    300,
    1800,
    "*/*",
  ).catch(() => null);

  const first = Array.isArray(aviationWeather) ? aviationWeather[0] : aviationWeather;
  if (first && typeof first === "object") {
    const record = first as Record<string, unknown>;
    const raw = String(
      record.rawTAF ??
        record.raw_text ??
        record.rawText ??
        record.raw ??
        record.taf ??
        "",
    ).trim();
    if (raw) {
      return {
        raw,
        issuanceTime: String(
          record.issueTime ?? record.issue_time ?? record.issuanceTime ?? record.obsTime ?? "",
        ),
      };
    }
  }

  const locId = icaoToLocationId(stationId);
  const list = await fetchCachedJson<any>(
    context,
    "/api/weather-gov/taf-products",
    new URLSearchParams({ locId }),
    `https://api.weather.gov/products/types/TAF/locations/${locId}`,
    300,
    1800,
    "application/geo+json, application/json",
  ).catch(() => null);

  const products: any[] = list?.["@graph"] ?? [];
  if (products.length === 0) return null;

  const productPath = resolveProductPath(products[0]);
  if (!productPath) return null;
  const product = await fetchCachedJson<any>(
    context,
    "/api/weather-gov/product",
    new URLSearchParams({ productPath }),
    `https://api.weather.gov/${productPath}`,
    300,
    1800,
    "application/geo+json, application/json",
  );

  return {
    raw: product.productText ?? "",
    issuanceTime: product.issuanceTime ?? products[0].issuanceTime ?? "",
  };
}

export async function fetchDiscussion(
  context: ContextLike,
  lat: number,
  lon: number,
): Promise<DiscussionData | null> {
  const points = await fetchCachedJson<any>(
    context,
    "/api/weather-gov/points",
    new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) }),
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    300,
    1800,
    "application/geo+json, application/json",
  ).catch(() => null);

  const officeCode =
    normalizeOfficeCode(points?.properties?.gridId) ||
    officeCodeFromUrl(points?.properties?.forecastOffice);
  if (!officeCode) return null;

  let products: any[] = [];
  try {
    const primary = await fetchCachedJson<any>(
      context,
      "/api/weather-gov/afd-office",
      new URLSearchParams({ officeCode }),
      `https://api.weather.gov/products/types/AFD/locations/${officeCode}`,
      45,
      300,
      "application/geo+json, application/json",
    );
    products = Array.isArray(primary?.["@graph"]) ? primary["@graph"] : [];
  } catch {
    products = [];
  }

  if (products.length === 0) {
    const fallback = await fetchCachedJson<any>(
      context,
      "/api/weather-gov/afd-global",
      new URLSearchParams(),
      "https://api.weather.gov/products/types/AFD",
      45,
      300,
      "application/geo+json, application/json",
    ).catch(() => null);
    const fallbackProducts: any[] = Array.isArray(fallback?.["@graph"]) ? fallback["@graph"] : [];
    products = fallbackProducts.filter((item) => officeMatchesProduct(item, officeCode));
  }

  if (products.length === 0) return null;
  products.sort((left, right) => Date.parse(right?.issuanceTime ?? "") - Date.parse(left?.issuanceTime ?? ""));
  const productPath = resolveProductPath(products[0]);
  if (!productPath) return null;

  const product = await fetchCachedJson<any>(
    context,
    "/api/weather-gov/product-details",
    new URLSearchParams({ productPath }),
    `https://api.weather.gov/${productPath}`,
    60,
    300,
    "application/geo+json, application/json",
  );

  const rawText = typeof product?.productText === "string" ? product.productText : "";
  if (!rawText) return null;

  return {
    title: "Area Forecast Discussion",
    office: `National Weather Service ${officeCode}`,
    officeCode,
    issueTime: product?.issuanceTime || products[0]?.issuanceTime || "",
    content: normalizeDiscussionSection(rawText),
    sourceUrl: `https://forecast.weather.gov/product.php?site=nws&issuedby=${officeCode}&product=afd&format=ci&version=1&glossary=1&highlight=off`,
  };
}

export async function fetchBriefing(
  context: ContextLike,
  location: { id: string; name: string; lat: number; lon: number; airport: string },
): Promise<BriefingResponse> {
  const [{ current, hourly, daily }, nearbyStations, discussion] = await Promise.all([
    fetchWeatherBundle(context, location.lat, location.lon),
    fetchNearbyStationsBundle(context, location.lat, location.lon).catch(() => []),
    fetchDiscussion(context, location.lat, location.lon).catch(() => null),
  ]);

  const stationBundles = await Promise.all(
    nearbyStations.slice(0, 3).map(async (station) => ({
      station,
      metar: await fetchMetar(context, station.stationId).catch(() => null),
      taf: await fetchTaf(context, station.stationId).catch(() => null),
    })),
  );

  return {
    location,
    current,
    hourly,
    daily,
    nearbyStations,
    stationBundles,
    discussion,
    lastUpdated: new Date().toISOString(),
  };
}

export async function fetchWinds(
  context: ContextLike,
  lat: number,
  lon: number,
): Promise<WindResponse> {
  const plVars: string[] = [];
  for (const level of PRESSURE_LEVELS) {
    plVars.push(`temperature_${level}hPa`);
    plVars.push(`wind_speed_${level}hPa`);
    plVars.push(`wind_direction_${level}hPa`);
    plVars.push(`geopotential_height_${level}hPa`);
  }
  const lowLevelVars: string[] = [];
  for (const level of NEAR_SURFACE_LEVELS_M) {
    lowLevelVars.push(`temperature_${level}m`);
    lowLevelVars.push(`wind_speed_${level}m`);
    lowLevelVars.push(`wind_direction_${level}m`);
  }
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: [
      ...plVars,
      ...lowLevelVars,
      "temperature_2m",
      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",
      "cape",
      "convective_inhibition",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "visibility",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    past_hours: "4",
    forecast_hours: "8",
  });

  const json = await fetchCachedJson<any>(
    context,
    "/api/winds",
    params,
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    600,
    3600,
  );

  const elevation_m = json.elevation ?? 0;
  const elevationFt = elevation_m * 3.28084;
  const hourly = json.hourly ?? {};
  const times: string[] = hourly.time ?? [];

  const hours: WindAloftHour[] = times.map((time, index) => {
    const levels: PressureLevelRow[] = PRESSURE_LEVELS.map((level) => {
      const altitudeMSL_m = Math.round(hourly[`geopotential_height_${level}hPa`]?.[index] ?? 0);
      const altitudeMSL_ft = Math.round(altitudeMSL_m * 3.28084);
      const altitudeAGL_ft = Math.max(0, altitudeMSL_ft - Math.round(elevationFt));
      return {
        pressureLevel: level,
        altitudeMSL_m,
        altitudeMSL_ft,
        altitudeAGL_ft,
        temperature_F: Math.round(hourly[`temperature_${level}hPa`]?.[index] ?? 0),
        windSpeed_mph: Math.round(hourly[`wind_speed_${level}hPa`]?.[index] ?? 0),
        windDirection: normalizeDirection(hourly[`wind_direction_${level}hPa`]?.[index] ?? 0),
      };
    });

    const surfaceTemp_F = Math.round(hourly.temperature_2m?.[index] ?? 0);
    const surfaceWindSpeed_mph = Math.round(hourly.wind_speed_10m?.[index] ?? 0);
    const surfaceWindDirection = normalizeDirection(hourly.wind_direction_10m?.[index] ?? 0);
    const surfaceWindGust_mph = Math.round(hourly.wind_gusts_10m?.[index] ?? hourly.wind_speed_10m?.[index] ?? 0);

    const windAnchors: WindHeightSample[] = [
      {
        heightFt: Math.round(10 * 3.28084),
        speedMph: surfaceWindSpeed_mph,
        directionDeg: surfaceWindDirection,
      },
      ...levels.map((level) => ({
        heightFt: level.altitudeAGL_ft,
        speedMph: level.windSpeed_mph,
        directionDeg: level.windDirection,
      })),
    ];

    const temperatureAnchors: ScalarHeightSample[] = [
      {
        heightFt: Math.round(2 * 3.28084),
        value: surfaceTemp_F,
      },
      ...levels.map((level) => ({
        heightFt: level.altitudeAGL_ft,
        value: level.temperature_F,
      })),
    ];

    const nearSurfaceLevels: NearSurfaceLevelRow[] = NEAR_SURFACE_LEVELS_M.map((level) => {
      const aglFt = Math.round(level * 3.28084);
      const interpolatedWind = interpolateWindAtHeight(windAnchors, aglFt);
      const rawWindSpeed = hourly[`wind_speed_${level}m`]?.[index];
      const rawWindDirection = hourly[`wind_direction_${level}m`]?.[index];
      const rawTemperature = hourly[`temperature_${level}m`]?.[index];
      const hasRawWind = Number.isFinite(rawWindSpeed) && Number.isFinite(rawWindDirection);
      return {
        altitudeAGL_ft: aglFt,
        altitudeMSL_ft: aglFt + Math.round(elevationFt),
        temperature_F: Number.isFinite(rawTemperature)
          ? Math.round(rawTemperature)
          : Math.round(interpolateScalarAtHeight(temperatureAnchors, aglFt) ?? surfaceTemp_F),
        windSpeed_mph: hasRawWind ? Math.round(rawWindSpeed) : Math.round(interpolatedWind?.speedMph ?? surfaceWindSpeed_mph),
        windDirection: hasRawWind
          ? normalizeDirection(rawWindDirection)
          : normalizeDirection(interpolatedWind?.directionDeg ?? surfaceWindDirection),
        source: hasRawWind ? "open-meteo" : "derived",
      };
    }).sort((a, b) => a.altitudeAGL_ft - b.altitudeAGL_ft);

    return {
      time,
      cape: Math.round(hourly.cape?.[index] ?? 0),
      cin: Math.round(hourly.convective_inhibition?.[index] ?? 0),
      cloudCover: Math.round(hourly.cloud_cover?.[index] ?? 0),
      cloudCoverLow: Math.round(hourly.cloud_cover_low?.[index] ?? 0),
      cloudCoverMid: Math.round(hourly.cloud_cover_mid?.[index] ?? 0),
      cloudCoverHigh: Math.round(hourly.cloud_cover_high?.[index] ?? 0),
      visibility_m: hourly.visibility?.[index] ?? 10000,
      surfaceTemp_F,
      surfaceWindSpeed_mph,
      surfaceWindGust_mph,
      surfaceWindDirection,
      nearSurfaceLevels,
      levels,
      normalizedLevels: NORMALIZED_ALTITUDES_AGL.map((target) => interpolateToAGL(levels, target)).filter(
        (row): row is PressureLevelRow => row !== null,
      ),
    };
  });

  return {
    location: { lat, lon },
    elevation_m,
    hours,
    lastUpdated: new Date().toISOString(),
  };
}
