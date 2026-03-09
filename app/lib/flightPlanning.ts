import type {
  NearSurfaceLevelRow,
  PressureLevelRow,
  WindAloftHour,
} from "../hooks/useWindAloft";
import { latLonToLocalNm, localNmToLatLon } from "./balloonTrajectory";

const MPH_TO_KT = 0.868976;

export interface FlightAltitudeOption {
  id: string;
  altitudeAGL_ft: number;
  altitudeMSL_ft: number;
  pressureLevel?: number;
  source: "near-surface" | "pressure";
}

export interface SimulatedFlight {
  departureTime: Date;
  durationMin: number;
  effectiveDurationMin: number;
  limitedByForecast: boolean;
  altitudeMSL_ft: number;
  altitudeAGL_ft: number;
  startWindSpeedKt: number;
  startWindDirection: number;
  avgGroundspeedKt: number;
  distanceNm: number;
  bearingDeg: number;
  endpointLat: number;
  endpointLon: number;
}

interface UnifiedLevel {
  altitudeAGL_ft: number;
  altitudeMSL_ft: number;
  windSpeed_mph: number;
  windDirection: number;
  pressureLevel?: number;
  source: "near-surface" | "pressure";
}

interface WindSample {
  timeMs: number;
  speedKt: number;
  directionDeg: number;
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function shortestAngularDelta(fromDeg: number, toDeg: number): number {
  let delta = toDeg - fromDeg;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function bearingFromDisplacement(eastNm: number, northNm: number): number {
  if (Math.abs(eastNm) < 1e-6 && Math.abs(northNm) < 1e-6) return 0;
  return normalizeDegrees((Math.atan2(eastNm, northNm) * 180) / Math.PI);
}

function dedupeAltitudeOptions(levels: UnifiedLevel[]): UnifiedLevel[] {
  const sorted = [...levels].sort((a, b) => a.altitudeMSL_ft - b.altitudeMSL_ft);
  const deduped: UnifiedLevel[] = [];

  for (const level of sorted) {
    const previous = deduped[deduped.length - 1];
    if (!previous || Math.abs(level.altitudeMSL_ft - previous.altitudeMSL_ft) > 175) {
      deduped.push(level);
      continue;
    }

    if (previous.source === "pressure" && level.source === "near-surface") {
      deduped[deduped.length - 1] = level;
    }
  }

  return deduped;
}

function mergeHourLevels(hour: WindAloftHour): UnifiedLevel[] {
  const nearSurface = hour.nearSurfaceLevels.map((level): UnifiedLevel => ({
    altitudeAGL_ft: level.altitudeAGL_ft,
    altitudeMSL_ft: level.altitudeMSL_ft,
    windSpeed_mph: level.windSpeed_mph,
    windDirection: level.windDirection,
    source: "near-surface",
  }));

  const pressureLevels = hour.levels.map((level): UnifiedLevel => ({
    altitudeAGL_ft: level.altitudeAGL_ft,
    altitudeMSL_ft: level.altitudeMSL_ft,
    windSpeed_mph: level.windSpeed_mph,
    windDirection: level.windDirection,
    pressureLevel: level.pressureLevel,
    source: "pressure",
  }));

  return dedupeAltitudeOptions([...nearSurface, ...pressureLevels]);
}

function interpolateDirection(
  leftDirectionDeg: number,
  rightDirectionDeg: number,
  factor: number,
): number {
  const delta = shortestAngularDelta(leftDirectionDeg, rightDirectionDeg);
  return normalizeDegrees(leftDirectionDeg + delta * factor);
}

function interpolateWindAtAltitude(
  levels: UnifiedLevel[],
  targetAltitudeMslFt: number,
): UnifiedLevel | null {
  if (levels.length === 0) return null;

  const sorted = [...levels].sort((a, b) => a.altitudeMSL_ft - b.altitudeMSL_ft);
  const reference = sorted[0];
  const groundElevationFt = reference.altitudeMSL_ft - reference.altitudeAGL_ft;

  if (targetAltitudeMslFt <= sorted[0].altitudeMSL_ft) {
    return {
      ...sorted[0],
      altitudeMSL_ft: targetAltitudeMslFt,
      altitudeAGL_ft: Math.max(0, targetAltitudeMslFt - groundElevationFt),
    };
  }

  if (targetAltitudeMslFt >= sorted[sorted.length - 1].altitudeMSL_ft) {
    return {
      ...sorted[sorted.length - 1],
      altitudeMSL_ft: targetAltitudeMslFt,
      altitudeAGL_ft: Math.max(0, targetAltitudeMslFt - groundElevationFt),
    };
  }

  for (let index = 0; index < sorted.length - 1; index++) {
    const lower = sorted[index];
    const upper = sorted[index + 1];
    if (targetAltitudeMslFt < lower.altitudeMSL_ft || targetAltitudeMslFt > upper.altitudeMSL_ft) {
      continue;
    }

    const range = upper.altitudeMSL_ft - lower.altitudeMSL_ft;
    const factor = range <= 0 ? 0 : (targetAltitudeMslFt - lower.altitudeMSL_ft) / range;

    const lowerX = lower.windSpeed_mph * Math.cos((lower.windDirection * Math.PI) / 180);
    const lowerY = lower.windSpeed_mph * Math.sin((lower.windDirection * Math.PI) / 180);
    const upperX = upper.windSpeed_mph * Math.cos((upper.windDirection * Math.PI) / 180);
    const upperY = upper.windSpeed_mph * Math.sin((upper.windDirection * Math.PI) / 180);

    const windX = lowerX + factor * (upperX - lowerX);
    const windY = lowerY + factor * (upperY - lowerY);

    return {
      altitudeMSL_ft: targetAltitudeMslFt,
      altitudeAGL_ft: Math.max(0, targetAltitudeMslFt - groundElevationFt),
      windSpeed_mph: Math.max(0, Math.sqrt(windX ** 2 + windY ** 2)),
      windDirection: interpolateDirection(lower.windDirection, upper.windDirection, factor),
      pressureLevel: lower.pressureLevel,
      source: lower.source,
    };
  }

  return null;
}

function buildTemporalProfile(hours: WindAloftHour[], targetAltitudeMslFt: number): WindSample[] {
  return [...hours]
    .filter((hour) => Number.isFinite(hour.time.getTime()))
    .sort((a, b) => a.time.getTime() - b.time.getTime())
    .map((hour) => {
      const interpolated = interpolateWindAtAltitude(mergeHourLevels(hour), targetAltitudeMslFt);
      return interpolated
        ? {
            timeMs: hour.time.getTime(),
            speedKt: Math.max(0, interpolated.windSpeed_mph * MPH_TO_KT),
            directionDeg: normalizeDegrees(interpolated.windDirection),
          }
        : null;
    })
    .filter((sample): sample is WindSample => sample !== null);
}

function interpolateWindInTime(profile: WindSample[], targetTimeMs: number): WindSample | null {
  if (profile.length === 0) return null;
  if (targetTimeMs <= profile[0].timeMs) return { ...profile[0], timeMs: targetTimeMs };
  if (targetTimeMs >= profile[profile.length - 1].timeMs) {
    return { ...profile[profile.length - 1], timeMs: targetTimeMs };
  }

  for (let index = 0; index < profile.length - 1; index++) {
    const left = profile[index];
    const right = profile[index + 1];
    if (targetTimeMs < left.timeMs || targetTimeMs > right.timeMs) continue;

    const span = right.timeMs - left.timeMs;
    const factor = span <= 0 ? 0 : (targetTimeMs - left.timeMs) / span;
    return {
      timeMs: targetTimeMs,
      speedKt: left.speedKt + (right.speedKt - left.speedKt) * factor,
      directionDeg: interpolateDirection(left.directionDeg, right.directionDeg, factor),
    };
  }

  return { ...profile[profile.length - 1], timeMs: targetTimeMs };
}

export function buildFlightAltitudeOptions(hour: WindAloftHour | null): FlightAltitudeOption[] {
  if (!hour) return [];

  return mergeHourLevels(hour).map((level) => ({
    id: `${Math.round(level.altitudeMSL_ft)}`,
    altitudeAGL_ft: Math.round(level.altitudeAGL_ft),
    altitudeMSL_ft: Math.round(level.altitudeMSL_ft),
    pressureLevel: level.pressureLevel,
    source: level.source,
  }));
}

export function formatAltitudeOptionLabel(option: FlightAltitudeOption): string {
  const agl = `${Math.round(option.altitudeAGL_ft).toLocaleString()} ft AGL`;
  const msl = `${Math.round(option.altitudeMSL_ft).toLocaleString()} ft MSL`;
  if (option.pressureLevel) return `${agl} · ${msl} · ${option.pressureLevel} mb`;
  return `${agl} · ${msl}`;
}

export function simulateFlight(
  hours: WindAloftHour[],
  launchLat: number,
  launchLon: number,
  departureTime: Date,
  durationMin: number,
  altitude: FlightAltitudeOption,
  stepMinutes = 2,
): SimulatedFlight | null {
  const profile = buildTemporalProfile(hours, altitude.altitudeMSL_ft);
  if (profile.length === 0) return null;

  const departureMs = departureTime.getTime();
  const lastSampleMs = profile[profile.length - 1].timeMs;
  const maxAvailableMin = Math.max(0, Math.floor((lastSampleMs - departureMs) / 60000));
  const effectiveDurationMin = Math.min(Math.max(0, durationMin), maxAvailableMin);
  const startWind = interpolateWindInTime(profile, departureMs);
  if (!startWind) return null;

  let eastNm = 0;
  let northNm = 0;
  let elapsedMin = 0;
  const segmentMinutes = Math.max(1, Math.floor(stepMinutes));

  while (elapsedMin < effectiveDurationMin) {
    const currentSegmentMin = Math.min(segmentMinutes, effectiveDurationMin - elapsedMin);
    const sampleTimeMs = departureMs + (elapsedMin + currentSegmentMin / 2) * 60000;
    const wind = interpolateWindInTime(profile, sampleTimeMs) ?? startWind;
    const driftBearingDeg = normalizeDegrees(wind.directionDeg + 180);
    const driftBearingRad = (driftBearingDeg * Math.PI) / 180;
    const distanceNm = wind.speedKt * (currentSegmentMin / 60);

    eastNm += Math.sin(driftBearingRad) * distanceNm;
    northNm += Math.cos(driftBearingRad) * distanceNm;
    elapsedMin += currentSegmentMin;
  }

  const endpoint = localNmToLatLon(eastNm, northNm, launchLat, launchLon);
  const distanceNm = Math.sqrt(eastNm ** 2 + northNm ** 2);

  return {
    departureTime,
    durationMin,
    effectiveDurationMin,
    limitedByForecast: effectiveDurationMin < durationMin,
    altitudeMSL_ft: altitude.altitudeMSL_ft,
    altitudeAGL_ft: altitude.altitudeAGL_ft,
    startWindSpeedKt: startWind.speedKt,
    startWindDirection: startWind.directionDeg,
    avgGroundspeedKt: effectiveDurationMin > 0 ? distanceNm / (effectiveDurationMin / 60) : 0,
    distanceNm,
    bearingDeg: bearingFromDisplacement(eastNm, northNm),
    endpointLat: endpoint.lat,
    endpointLon: endpoint.lon,
  };
}

export function distanceBetweenCoordinatesNm(
  originLat: number,
  originLon: number,
  targetLat: number,
  targetLon: number,
): number {
  const displacement = latLonToLocalNm(targetLat, targetLon, originLat, originLon);
  return Math.sqrt(displacement.eastNm ** 2 + displacement.northNm ** 2);
}

export function buildPressureRowOption(row: PressureLevelRow): FlightAltitudeOption {
  return {
    id: `${Math.round(row.altitudeMSL_ft)}`,
    altitudeAGL_ft: Math.round(row.altitudeAGL_ft),
    altitudeMSL_ft: Math.round(row.altitudeMSL_ft),
    pressureLevel: row.pressureLevel,
    source: "pressure",
  };
}

export function buildNearSurfaceOption(row: NearSurfaceLevelRow): FlightAltitudeOption {
  return {
    id: `${Math.round(row.altitudeMSL_ft)}`,
    altitudeAGL_ft: Math.round(row.altitudeAGL_ft),
    altitudeMSL_ft: Math.round(row.altitudeMSL_ft),
    source: "near-surface",
  };
}
