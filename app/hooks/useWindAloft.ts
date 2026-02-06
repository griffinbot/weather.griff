import { useState, useEffect, useCallback, useRef } from "react";
import { openMeteoFetch } from "../services/weatherProxy";

// ---------------------------------------------------------------------------
// Pressure levels we request from Open-Meteo (millibars)
// ---------------------------------------------------------------------------
export const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 650, 600, 550, 500, 450,
  400, 350, 300, 250, 200,
] as const;

export type PressureLevel = (typeof PRESSURE_LEVELS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PressureLevelRow {
  pressureLevel: number; // hPa / mb
  altitudeMSL_m: number; // geopotential height in metres above sea level
  altitudeMSL_ft: number; // … in feet
  altitudeAGL_ft: number; // … above ground in feet
  temperature_F: number; // °F (raw from API)
  windSpeed_mph: number; // mph (raw from API)
  windDirection: number; // degrees
}

export interface WindAloftHour {
  time: Date;
  cape: number;
  cin: number;
  cloudCover: number; // %
  cloudCoverLow: number;
  cloudCoverMid: number;
  cloudCoverHigh: number;
  visibility_m: number; // metres
  surfaceTemp_F: number;
  surfaceWindSpeed_mph: number;
  surfaceWindDirection: number;
  levels: PressureLevelRow[];
}

export interface WindAloftState {
  hours: WindAloftHour[];
  elevation_m: number; // ground elevation in metres
  loading: boolean;
  error: string | null;
}

// Normalized altitude targets (feet AGL) for the "normalized" view
export const NORMALIZED_ALTITUDES_AGL = [
  100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000,
  8000, 9000, 10000, 12000, 14000, 16000, 18000,
];

// ---------------------------------------------------------------------------
// Build the Open-Meteo URL
// ---------------------------------------------------------------------------

function buildUrl(lat: number, lon: number): string {
  // Pressure-level variables
  const plVars: string[] = [];
  for (const lv of PRESSURE_LEVELS) {
    plVars.push(`temperature_${lv}hPa`);
    plVars.push(`wind_speed_${lv}hPa`);
    plVars.push(`wind_direction_${lv}hPa`);
    plVars.push(`geopotential_height_${lv}hPa`);
  }

  // Surface & convective variables
  const surfVars = [
    "temperature_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "cape",
    "convective_inhibition",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "visibility",
  ];

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [...plVars, ...surfVars].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    past_hours: "12",
    forecast_hours: "12",
  });

  return `/api/open-meteo/forecast?${params}`;
}

// ---------------------------------------------------------------------------
// Parse the raw API response
// ---------------------------------------------------------------------------

function parseResponse(
  json: any,
): { hours: WindAloftHour[]; elevation_m: number } {
  const elevation_m: number = json.elevation ?? 0;
  const elevFt = elevation_m * 3.28084;
  const times: string[] = json.hourly.time;

  const hours: WindAloftHour[] = times.map((t, i) => {
    const levels: PressureLevelRow[] = PRESSURE_LEVELS.map((lv) => {
      const geoKey = `geopotential_height_${lv}hPa`;
      const tempKey = `temperature_${lv}hPa`;
      const wsKey = `wind_speed_${lv}hPa`;
      const wdKey = `wind_direction_${lv}hPa`;

      const altMSL_m: number = json.hourly[geoKey]?.[i] ?? 0;
      const altMSL_ft = Math.round(altMSL_m * 3.28084);
      const altAGL_ft = Math.max(0, altMSL_ft - Math.round(elevFt));

      return {
        pressureLevel: lv,
        altitudeMSL_m: Math.round(altMSL_m),
        altitudeMSL_ft: altMSL_ft,
        altitudeAGL_ft: altAGL_ft,
        temperature_F: Math.round(json.hourly[tempKey]?.[i] ?? 0),
        windSpeed_mph: Math.round(json.hourly[wsKey]?.[i] ?? 0),
        windDirection: Math.round(json.hourly[wdKey]?.[i] ?? 0),
      };
    });

    return {
      time: new Date(t),
      cape: Math.round(json.hourly.cape?.[i] ?? 0),
      cin: Math.round(json.hourly.convective_inhibition?.[i] ?? 0),
      cloudCover: Math.round(json.hourly.cloud_cover?.[i] ?? 0),
      cloudCoverLow: Math.round(json.hourly.cloud_cover_low?.[i] ?? 0),
      cloudCoverMid: Math.round(json.hourly.cloud_cover_mid?.[i] ?? 0),
      cloudCoverHigh: Math.round(json.hourly.cloud_cover_high?.[i] ?? 0),
      visibility_m: json.hourly.visibility?.[i] ?? 10000,
      surfaceTemp_F: Math.round(json.hourly.temperature_2m?.[i] ?? 0),
      surfaceWindSpeed_mph: Math.round(json.hourly.wind_speed_10m?.[i] ?? 0),
      surfaceWindDirection: Math.round(
        json.hourly.wind_direction_10m?.[i] ?? 0,
      ),
      levels,
    };
  });

  return { hours, elevation_m };
}

// ---------------------------------------------------------------------------
// Interpolation helper — linearly interpolate to a target AGL altitude
// ---------------------------------------------------------------------------

export function interpolateToAGL(
  levels: PressureLevelRow[],
  targetAGL_ft: number,
): PressureLevelRow | null {
  // Sort levels ascending by AGL
  const sorted = [...levels].sort(
    (a, b) => a.altitudeAGL_ft - b.altitudeAGL_ft,
  );

  // If target is below the lowest or above the highest, extrapolate from nearest
  if (targetAGL_ft <= sorted[0].altitudeAGL_ft) return { ...sorted[0], altitudeAGL_ft: targetAGL_ft };
  if (targetAGL_ft >= sorted[sorted.length - 1].altitudeAGL_ft)
    return { ...sorted[sorted.length - 1], altitudeAGL_ft: targetAGL_ft };

  // Find bounding pair
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (targetAGL_ft >= lo.altitudeAGL_ft && targetAGL_ft <= hi.altitudeAGL_ft) {
      const range = hi.altitudeAGL_ft - lo.altitudeAGL_ft;
      const t = range === 0 ? 0 : (targetAGL_ft - lo.altitudeAGL_ft) / range;

      // Linear interpolation for direction needs special handling for wrap
      let dDir = hi.windDirection - lo.windDirection;
      if (dDir > 180) dDir -= 360;
      if (dDir < -180) dDir += 360;

      return {
        pressureLevel: Math.round(lo.pressureLevel + t * (hi.pressureLevel - lo.pressureLevel)),
        altitudeMSL_m: Math.round(lo.altitudeMSL_m + t * (hi.altitudeMSL_m - lo.altitudeMSL_m)),
        altitudeMSL_ft: Math.round(lo.altitudeMSL_ft + t * (hi.altitudeMSL_ft - lo.altitudeMSL_ft)),
        altitudeAGL_ft: targetAGL_ft,
        temperature_F: Math.round(lo.temperature_F + t * (hi.temperature_F - lo.temperature_F)),
        windSpeed_mph: Math.round(lo.windSpeed_mph + t * (hi.windSpeed_mph - lo.windSpeed_mph)),
        windDirection: Math.round(((lo.windDirection + t * dDir) % 360 + 360) % 360),
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useWindAloft(lat: number, lon: number): WindAloftState & { refetch: () => void } {
  const [state, setState] = useState<WindAloftState>({
    hours: [],
    elevation_m: 0,
    loading: true,
    error: null,
  });

  const abortRef = useRef(false);

  const fetchData = useCallback(async () => {
    abortRef.current = false;
    setState((p) => ({ ...p, loading: true, error: null }));

    try {
      const url = buildUrl(lat, lon);
      const json = await openMeteoFetch(url, 5 * 60_000);
      if (abortRef.current) return;
      const parsed = parseResponse(json);
      setState({ ...parsed, loading: false, error: null });
    } catch (err: any) {
      if (abortRef.current) return;
      setState((p) => ({ ...p, loading: false, error: err.message ?? "Failed to fetch wind aloft data" }));
    }
  }, [lat, lon]);

  useEffect(() => {
    fetchData();
    return () => {
      abortRef.current = true;
    };
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}
