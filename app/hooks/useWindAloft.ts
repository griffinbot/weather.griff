import { useState, useEffect, useCallback, useRef } from "react";
import { cachedFetch } from "../services/weatherProxy";
import type { WindResponse } from "../../shared/contracts";

// ---------------------------------------------------------------------------
// Pressure levels we request from Open-Meteo (millibars)
// ---------------------------------------------------------------------------
export const PRESSURE_LEVELS = [
  1000, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350,
  300, 250,
] as const;

export type PressureLevel = (typeof PRESSURE_LEVELS)[number];
export const NEAR_SURFACE_LEVELS_M = [80, 120, 180] as const;
const WIND_ALOFT_DEBUG = false;

type LowLevelSource = "open-meteo" | "derived";

export interface NearSurfaceLevelRow {
  altitudeAGL_ft: number;
  altitudeMSL_ft: number;
  temperature_F: number;
  windSpeed_mph: number;
  windDirection: number;
  source: LowLevelSource;
}

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
  surfaceWindGust_mph: number;
  surfaceWindDirection: number;
  nearSurfaceLevels: NearSurfaceLevelRow[];
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

  // Near-surface model levels (AGL, metres)
  const lowLevelVars: string[] = [];
  for (const lv of NEAR_SURFACE_LEVELS_M) {
    lowLevelVars.push(`temperature_${lv}m`);
    lowLevelVars.push(`wind_speed_${lv}m`);
    lowLevelVars.push(`wind_direction_${lv}m`);
  }

  // Surface & convective variables
  const surfVars = [
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
  ];

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [...plVars, ...lowLevelVars, ...surfVars].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    past_hours: "4",
    forecast_hours: "8",
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
  const hourly = json.hourly ?? {};
  const times: string[] = hourly.time ?? [];

  type WindHeightSample = {
    heightFt: number;
    speedMph: number;
    directionDeg: number;
  };

  type ScalarHeightSample = {
    heightFt: number;
    value: number;
  };

  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

  const normalizeDirection = (degrees: number): number =>
    ((Math.round(degrees) % 360) + 360) % 360;

  function interpolateScalarAtHeight(
    samples: ScalarHeightSample[],
    targetHeightFt: number,
  ): number | null {
    const sorted = [...samples]
      .filter((sample) => isFiniteNumber(sample.heightFt) && isFiniteNumber(sample.value))
      .sort((left, right) => left.heightFt - right.heightFt);

    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0].value;
    if (targetHeightFt <= sorted[0].heightFt) return sorted[0].value;
    if (targetHeightFt >= sorted[sorted.length - 1].heightFt) {
      return sorted[sorted.length - 1].value;
    }

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
    const sorted = [...samples]
      .filter(
        (sample) =>
          isFiniteNumber(sample.heightFt) &&
          isFiniteNumber(sample.speedMph) &&
          isFiniteNumber(sample.directionDeg),
      )
      .sort((left, right) => left.heightFt - right.heightFt);

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
    const speedMph = Math.max(0, Math.sqrt(interpolatedX ** 2 + interpolatedY ** 2));
    const directionDeg = normalizeDirection((Math.atan2(interpolatedY, interpolatedX) * 180) / Math.PI);

    return { speedMph, directionDeg };
  }

  const hours: WindAloftHour[] = times.map((t, i) => {
    const levels: PressureLevelRow[] = PRESSURE_LEVELS.map((lv) => {
      const geoKey = `geopotential_height_${lv}hPa`;
      const tempKey = `temperature_${lv}hPa`;
      const wsKey = `wind_speed_${lv}hPa`;
      const wdKey = `wind_direction_${lv}hPa`;

      const altMSL_m: number = hourly[geoKey]?.[i] ?? 0;
      const altMSL_ft = Math.round(altMSL_m * 3.28084);
      const altAGL_ft = Math.max(0, altMSL_ft - Math.round(elevFt));

      return {
        pressureLevel: lv,
        altitudeMSL_m: Math.round(altMSL_m),
        altitudeMSL_ft: altMSL_ft,
        altitudeAGL_ft: altAGL_ft,
        temperature_F: Math.round(hourly[tempKey]?.[i] ?? 0),
        windSpeed_mph: Math.round(hourly[wsKey]?.[i] ?? 0),
        windDirection: normalizeDirection(hourly[wdKey]?.[i] ?? 0),
      };
    });

    const surfaceTemp_F = Math.round(hourly.temperature_2m?.[i] ?? 0);
    const surfaceWindSpeed_mph = Math.round(hourly.wind_speed_10m?.[i] ?? 0);
    const surfaceWindDirection = normalizeDirection(hourly.wind_direction_10m?.[i] ?? 0);
    const surfaceWindGust_mph = Math.round(
      hourly.wind_gusts_10m?.[i] ?? hourly.wind_speed_10m?.[i] ?? 0,
    );

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

    const nearSurfaceLevels = NEAR_SURFACE_LEVELS_M.map((lv): NearSurfaceLevelRow | null => {
      const tempKey = `temperature_${lv}m`;
      const wsKey = `wind_speed_${lv}m`;
      const wdKey = `wind_direction_${lv}m`;

      const aglFt = Math.round(lv * 3.28084);
      const rawTemperature = hourly[tempKey]?.[i];
      const rawWindSpeed = hourly[wsKey]?.[i];
      const rawWindDirection = hourly[wdKey]?.[i];

      const rawWindAvailable =
        isFiniteNumber(rawWindSpeed) && isFiniteNumber(rawWindDirection);

      const interpolatedWind = interpolateWindAtHeight(windAnchors, aglFt);
      if (!rawWindAvailable && !interpolatedWind) return null;

      const windSpeed_mph = rawWindAvailable
        ? Math.round(rawWindSpeed)
        : Math.round(interpolatedWind!.speedMph);
      const windDirection = rawWindAvailable
        ? normalizeDirection(rawWindDirection)
        : normalizeDirection(interpolatedWind!.directionDeg);

      const interpolatedTemp = interpolateScalarAtHeight(temperatureAnchors, aglFt);
      const temperature_F = isFiniteNumber(rawTemperature)
        ? Math.round(rawTemperature)
        : Math.round(interpolatedTemp ?? surfaceTemp_F);

      const source: LowLevelSource = rawWindAvailable ? "open-meteo" : "derived";

      return {
        altitudeAGL_ft: aglFt,
        altitudeMSL_ft: aglFt + Math.round(elevFt),
        temperature_F,
        windSpeed_mph,
        windDirection,
        source,
      };
    })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.altitudeAGL_ft - b.altitudeAGL_ft);

    if (WIND_ALOFT_DEBUG && nearSurfaceLevels.some((row) => row.source === "derived")) {
      console.debug("[useWindAloft] derived low-level rows", {
        time: t,
        nearSurfaceLevels,
      });
    }

    return {
      time: new Date(t),
      cape: Math.round(hourly.cape?.[i] ?? 0),
      cin: Math.round(hourly.convective_inhibition?.[i] ?? 0),
      cloudCover: Math.round(hourly.cloud_cover?.[i] ?? 0),
      cloudCoverLow: Math.round(hourly.cloud_cover_low?.[i] ?? 0),
      cloudCoverMid: Math.round(hourly.cloud_cover_mid?.[i] ?? 0),
      cloudCoverHigh: Math.round(hourly.cloud_cover_high?.[i] ?? 0),
      visibility_m: hourly.visibility?.[i] ?? 10000,
      surfaceTemp_F,
      surfaceWindSpeed_mph,
      surfaceWindGust_mph,
      surfaceWindDirection,
      nearSurfaceLevels,
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
      const json = await cachedFetch<WindResponse>(
        `/api/winds?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`,
        undefined,
        10 * 60_000,
        10_000,
      );
      if (abortRef.current) return;
      const parsed = {
        elevation_m: json.elevation_m,
        hours: json.hours.map((hour) => ({
          ...hour,
          time: new Date(hour.time),
        })),
      };
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
