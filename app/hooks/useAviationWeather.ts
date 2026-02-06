import { useState, useEffect, useCallback } from "react";
import { weatherGovFetch, cachedFetch } from "../services/weatherProxy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NearbyStation {
  stationId: string; // ICAO, e.g. "KSEA"
  name: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  distance_mi: number; // computed client-side
}

export interface MetarData {
  raw: string;
  timestamp: string; // ISO
  description: string; // e.g. "Light Rain"
  temperature_C: number | null;
  dewpoint_C: number | null;
  windDirection: number | null;
  windSpeed_kmh: number | null;
  windGust_kmh: number | null;
  visibility_m: number | null;
  barometricPressure_Pa: number | null;
  relativeHumidity: number | null;
  cloudLayers: { base_m: number | null; amount: string }[];
}

export interface TafData {
  raw: string;
  issuanceTime: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3959; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Convert ICAO code to the 3-letter location id used by weather.gov products.
 *  US stations: KSEA → SEA, KJFK → JFK
 *  Other: return full id (may not work for all, handled gracefully). */
function icaoToLocationId(icao: string): string {
  if (icao.length === 4 && icao.startsWith("K")) return icao.slice(1);
  if (icao.length === 4 && icao.startsWith("P")) return icao.slice(1); // Alaska/Pacific
  return icao;
}

function toWeatherGovProxyUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("https://api.weather.gov/")) {
    const parsed = new URL(pathOrUrl);
    return `/api/weather-gov${parsed.pathname}${parsed.search}`;
  }
  if (pathOrUrl.startsWith("/")) return `/api/weather-gov${pathOrUrl}`;
  return `/api/weather-gov/${pathOrUrl}`;
}

function stationIdCandidates(stationId: string): string[] {
  const normalized = stationId.trim().toUpperCase();
  const candidates = [normalized];
  if ((normalized.startsWith("K") || normalized.startsWith("P")) && normalized.length === 4) {
    candidates.push(normalized.slice(1));
  }
  return Array.from(new Set(candidates));
}

function extractRawMetarFromUnknownPayload(payload: unknown): string {
  if (!payload) return "";

  if (typeof payload === "string") {
    const text = payload.trim();
    if (!text) return "";
    if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) return "";
    return text;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const fromEntry = extractRawMetarFromUnknownPayload(entry);
      if (fromEntry) return fromEntry;
    }
    return "";
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidateFields = ["rawOb", "raw_text", "rawText", "raw", "metar", "METAR"];
    for (const field of candidateFields) {
      const value = record[field];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }

    for (const value of Object.values(record)) {
      const nested = extractRawMetarFromUnknownPayload(value);
      if (nested) return nested;
    }
  }

  return "";
}

function resolveProductUrl(product: any): string | null {
  const atId = product?.["@id"];
  if (typeof atId === "string" && atId.length > 0) {
    return toWeatherGovProxyUrl(atId);
  }

  const id = product?.id;
  if (typeof id === "string" && id.length > 0) {
    return `/api/weather-gov/products/${id}`;
  }
  if (typeof id === "number") {
    return `/api/weather-gov/products/${String(id)}`;
  }
  return null;
}

async function fetchRawMetarFromAviationWeather(stationId: string): Promise<string> {
  const ids = stationIdCandidates(stationId).join(",");

  try {
    const response = await cachedFetch<any[] | Record<string, unknown> | string>(
      `/api/aviationweather?type=metar&ids=${encodeURIComponent(ids)}&format=json`,
      undefined,
      3 * 60_000,
    );
    const parsed = extractRawMetarFromUnknownPayload(response);
    if (parsed) return parsed;
  } catch {
    // Fallback below.
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(
        `/api/aviationweather?type=metar&ids=${encodeURIComponent(ids)}&format=raw`,
        { signal: controller.signal },
      );
      if (!response.ok) return "";
      const text = (await response.text()).trim();
      if (!text || text.startsWith("<!DOCTYPE") || text.startsWith("<html")) return "";
      return text;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return "";
  }
}

async function fetchRawMetarFromWeatherGovProducts(stationId: string): Promise<string> {
  try {
    const locId = icaoToLocationId(stationId);
    const locationCandidates = Array.from(new Set([locId, stationId.toUpperCase()]));

    let products: any[] = [];
    for (const locationCandidate of locationCandidates) {
      const listUrl = `/api/weather-gov/products/types/METAR/locations/${locationCandidate}`;
      const listJson = await weatherGovFetch<any>(listUrl, 3 * 60_000).catch(() => null);
      products = Array.isArray(listJson?.["@graph"]) ? listJson["@graph"] : [];
      if (products.length > 0) break;
    }

    if (products.length === 0) return "";

    const sortedProducts = [...products].sort((a, b) => {
      const aTs = Date.parse(a?.issuanceTime ?? "");
      const bTs = Date.parse(b?.issuanceTime ?? "");
      const aValue = Number.isFinite(aTs) ? aTs : 0;
      const bValue = Number.isFinite(bTs) ? bTs : 0;
      return bValue - aValue;
    });

    const productUrl = resolveProductUrl(sortedProducts[0]);
    if (!productUrl) return "";

    const productJson = await weatherGovFetch<any>(productUrl, 3 * 60_000);
    const rawText = typeof productJson?.productText === "string" ? productJson.productText.trim() : "";
    return rawText;
  } catch {
    return "";
  }
}

async function fetchRawTafFromAviationWeather(
  stationId: string,
): Promise<{ raw: string; issuanceTime: string }> {
  try {
    const ids = stationIdCandidates(stationId).join(",");
    const response = await cachedFetch<any[] | Record<string, unknown>>(
      `/api/aviationweather?type=taf&ids=${encodeURIComponent(ids)}&format=json`,
      undefined,
      5 * 60_000,
    );

    const first = Array.isArray(response) ? response[0] : response;
    if (!first || typeof first !== "object") return { raw: "", issuanceTime: "" };

    const rawCandidates = ["rawTAF", "raw_text", "rawText", "raw", "taf"];
    let raw = "";
    for (const field of rawCandidates) {
      const value = (first as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim().length > 0) {
        raw = value.trim();
        break;
      }
    }

    const issuanceCandidates = ["issueTime", "issue_time", "issuanceTime", "obsTime"];
    let issuanceTime = "";
    for (const field of issuanceCandidates) {
      const value = (first as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim().length > 0) {
        issuanceTime = value.trim();
        break;
      }
    }

    return { raw, issuanceTime };
  } catch {
    return { raw: "", issuanceTime: "" };
  }
}

// ---------------------------------------------------------------------------
// useNearbyStations — fetches observation stations near a point
// ---------------------------------------------------------------------------

export function useNearbyStations(lat: number, lon: number) {
  const [stations, setStations] = useState<NearbyStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // weather.gov: get observation stations sorted by proximity
      const url = `/api/weather-gov/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations`;
      const data = await weatherGovFetch<any>(url, 15 * 60_000); // cache 15 min

      const features: any[] = data.features ?? data.observationStations ?? [];

      const parsed: NearbyStation[] = features
        .slice(0, 12) // limit
        .map((f: any) => {
          const props = f.properties ?? {};
          const coords = f.geometry?.coordinates ?? [0, 0]; // [lon, lat]
          const sLat = coords[1];
          const sLon = coords[0];
          return {
            stationId: props.stationIdentifier ?? "",
            name: props.name ?? "Unknown",
            lat: sLat,
            lon: sLon,
            elevation_m: props.elevation?.value ?? null,
            distance_mi: haversine(lat, lon, sLat, sLon),
          };
        })
        .filter((s) => s.stationId); // drop entries without ID

      setStations(parsed);
    } catch (err: any) {
      console.error("[useNearbyStations]", err);
      const message = String(err?.message || "");
      setError(
        message.includes("HTTP 404")
          ? "Unable to fetch nearby stations from weather.gov. This feature is only available for US locations."
          : "Unable to fetch nearby stations from weather.gov.",
      );
      setStations([]);
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    fetchStations();
  }, [fetchStations]);

  return { stations, loading, error, refetch: fetchStations };
}

// ---------------------------------------------------------------------------
// useMetar — fetches latest observation for a station
// ---------------------------------------------------------------------------

export function useMetar(stationId: string | null) {
  const [data, setData] = useState<MetarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetar = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    setError(null);

    try {
      const url = `/api/weather-gov/stations/${stationId}/observations/latest`;
      let props: any = {};
      try {
        const json = await weatherGovFetch<any>(url, 3 * 60_000); // cache 3 min
        props = json?.properties ?? {};
      } catch (err) {
        console.warn("[useMetar] weather.gov observation failed; falling back to AviationWeather", err);
        props = {};
      }

      const weatherGovRaw = typeof props.rawMessage === "string" ? props.rawMessage.trim() : "";
      const aviationWeatherRaw = weatherGovRaw ? "" : await fetchRawMetarFromAviationWeather(stationId);
      const weatherGovProductRaw =
        weatherGovRaw || aviationWeatherRaw ? "" : await fetchRawMetarFromWeatherGovProducts(stationId);
      const rawMetar = weatherGovRaw || aviationWeatherRaw || weatherGovProductRaw;

      const hasStructured =
        typeof props.timestamp === "string" ||
        typeof props.textDescription === "string" ||
        props.temperature?.value != null ||
        props.windSpeed?.value != null;
      if (!rawMetar && !hasStructured) {
        throw new Error("No METAR data available for this station.");
      }

      const metar: MetarData = {
        raw: rawMetar,
        timestamp: props.timestamp ?? new Date().toISOString(),
        description: props.textDescription ?? "",
        temperature_C: props.temperature?.value ?? null,
        dewpoint_C: props.dewpoint?.value ?? null,
        windDirection: props.windDirection?.value ?? null,
        windSpeed_kmh: props.windSpeed?.value ?? null,
        windGust_kmh: props.windGust?.value ?? null,
        visibility_m: props.visibility?.value ?? null,
        barometricPressure_Pa: props.barometricPressure?.value ?? null,
        relativeHumidity: props.relativeHumidity?.value ?? null,
        cloudLayers: (props.cloudLayers ?? []).map((cl: any) => ({
          base_m: cl.base?.value ?? null,
          amount: cl.amount ?? "CLR",
        })),
      };

      setData(metar);
    } catch (err: any) {
      console.error("[useMetar]", err);
      setError("Unable to fetch METAR for this station.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    fetchMetar();
  }, [fetchMetar]);

  return { data, loading, error, refetch: fetchMetar };
}

// ---------------------------------------------------------------------------
// useTaf — fetches latest TAF product for a station
// ---------------------------------------------------------------------------

export function useTaf(stationId: string | null) {
  const [data, setData] = useState<TafData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTaf = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    setError(null);

    try {
      const aviationWeatherTaf = await fetchRawTafFromAviationWeather(stationId);
      if (aviationWeatherTaf.raw) {
        setData({
          raw: aviationWeatherTaf.raw,
          issuanceTime: aviationWeatherTaf.issuanceTime,
        });
        setLoading(false);
        return;
      }

      // Step 1: get product listing
      const locId = icaoToLocationId(stationId);
      const listUrl = `/api/weather-gov/products/types/TAF/locations/${locId}`;
      const listJson = await weatherGovFetch<any>(listUrl, 5 * 60_000);

      const products: any[] = listJson["@graph"] ?? [];
      if (products.length === 0) {
        setError("No TAF available for this station.");
        setData(null);
        setLoading(false);
        return;
      }

      // Step 2: fetch the latest product text
      const latestId = products[0]["@id"] ?? products[0].id;
      const productUrl =
        typeof latestId === "string"
          ? toWeatherGovProxyUrl(latestId)
          : `/api/weather-gov/products/${String(latestId)}`;

      const productJson = await weatherGovFetch<any>(productUrl, 5 * 60_000);

      setData({
        raw: productJson.productText ?? "",
        issuanceTime: productJson.issuanceTime ?? products[0].issuanceTime ?? "",
      });
    } catch (err: any) {
      console.error("[useTaf]", err);
      const message = String(err?.message || "");
      setError(
        message.includes("HTTP 404")
          ? "TAF not available — station may not issue terminal forecasts."
          : "Unable to fetch TAF for this station.",
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => {
    fetchTaf();
  }, [fetchTaf]);

  return { data, loading, error, refetch: fetchTaf };
}

// ---------------------------------------------------------------------------
// METAR Decoder helpers (for the structured weather.gov response)
// ---------------------------------------------------------------------------

/** Convert km/h to knots */
export function kmhToKnots(kmh: number | null): number | null {
  if (kmh == null) return null;
  return Math.round(kmh * 0.539957);
}

/** Convert m to feet */
export function metersToFeet(m: number | null): number | null {
  if (m == null) return null;
  return Math.round(m * 3.28084);
}

/** Convert m to statute miles */
export function metersToSM(m: number | null): string {
  if (m == null) return "N/A";
  const mi = m / 1609.34;
  if (mi >= 10) return "10+";
  return mi.toFixed(1);
}

/** Convert Pa to inHg */
export function paToInHg(pa: number | null): string {
  if (pa == null) return "N/A";
  return (pa * 0.00029530).toFixed(2);
}

/** Convert °C to °F */
export function cToF(c: number | null): number | null {
  if (c == null) return null;
  return Math.round(c * 9 / 5 + 32);
}

/** Format cloud layer for display */
export function formatCloudLayer(layer: { base_m: number | null; amount: string }): string {
  const ft = metersToFeet(layer.base_m);
  const baseStr = ft != null ? `${ft.toLocaleString()} ft` : "—";
  return `${layer.amount} @ ${baseStr}`;
}

/** Basic TAF text parser — splits into forecast periods */
export function parseTafPeriods(
  rawText: string,
): { header: string; periods: { label: string; body: string }[] } {
  const lines = rawText.trim().split("\n");
  let header = "";
  const periods: { label: string; body: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Identify period boundaries
    if (
      trimmed.startsWith("FM") ||
      trimmed.startsWith("TEMPO") ||
      trimmed.startsWith("BECMG") ||
      trimmed.startsWith("PROB")
    ) {
      const label = trimmed.slice(0, trimmed.indexOf(" ") > 0 ? trimmed.indexOf(" ") : undefined);
      periods.push({ label, body: trimmed });
    } else if (periods.length === 0) {
      // Still in the header / initial forecast
      header += (header ? " " : "") + trimmed;
    } else {
      // Continuation of the last period
      periods[periods.length - 1].body += " " + trimmed;
    }
  }

  // If no FM/TEMPO periods found, treat whole text as one period
  if (periods.length === 0 && header) {
    periods.push({ label: "INITIAL", body: header });
    header = "";
  }

  return { header, periods };
}
